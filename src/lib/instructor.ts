import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel, Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

// ─── Types ──────────────────────────────────────────────────────────────────

export type Room = {
  id: string
  code: string
  title: string
  owner_id: string
  status: 'open' | 'closed'
  created_at: string
  closed_at: string | null
}

export type QuestionStatus = 'open' | 'answered' | 'hidden'

export type Question = {
  id: string
  room_id: string
  body: string
  status: QuestionStatus
  vote_count: number
  created_at: string
  answered_at: string | null
  /** Only present for the owner (console); anon never gets it. */
  participant_id?: string
}

export type Poll = {
  id: string
  room_id: string
  prompt: string
  status: 'open' | 'closed'
  created_at: string
  closed_at: string | null
}

export type PollOption = {
  id: string
  poll_id: string
  label: string
  position: number
  vote_count: number
}

/** anon has column-level SELECT on questions; select('*') fails for anon. */
export const QUESTION_COLS_ANON = 'id,room_id,body,status,vote_count,created_at,answered_at'
const QUESTION_COLS_OWNER = `${QUESTION_COLS_ANON},participant_id`

// ─── Errors ─────────────────────────────────────────────────────────────────

const FRIENDLY: Record<string, string> = {
  'not allowed': "You don't have permission to do that. Are you signed in as the room's owner?",
  'slow down': 'Slow down a little and try again in a few seconds.',
  'room not found or closed': 'That room was not found, or it is closed.',
  'nickname must be 1–24 characters': 'Nicknames must be 1–24 characters.',
  'question must be 1–500 characters': 'Questions must be 1–500 characters.',
  'title must be 1–120 characters': 'Give the room a title of 1–120 characters.',
  'a poll needs 2–4 options': 'A poll needs 2–4 options.',
  'each option must be 1–80 characters': 'Each option must be 1–80 characters.',
  'prompt must be 1–200 characters': 'The poll question must be 1–200 characters.',
}

export function friendlyError(err: unknown): string {
  const msg =
    err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err)
  for (const [key, text] of Object.entries(FRIENDLY)) {
    if (msg.includes(key)) return text
  }
  if (/permission denied|JWT/i.test(msg)) return FRIENDLY['not allowed']
  if (/failed to fetch|network/i.test(msg)) return 'Network problem. Check the connection and try again.'
  return 'Something went wrong. Please try again.'
}

function need() {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

// ─── Auth ───────────────────────────────────────────────────────────────────

/** Current auth session; `undefined` while loading, `null` when signed out. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null)
  useEffect(() => {
    if (!supabase) return
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setSession(data.session)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [])
  return session
}

export async function signInWithGitHub() {
  const { error } = await need().auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: window.location.origin },
  })
  if (error) throw error
}

export async function signOut() {
  const { error } = await need().auth.signOut()
  if (error) throw error
}

// ─── Rooms ──────────────────────────────────────────────────────────────────

export async function createRoom(title: string): Promise<Room> {
  const { data, error } = await need().rpc('create_room', { p_title: title })
  if (error) throw error
  return data as Room
}

export async function listMyRooms(uid: string): Promise<Room[]> {
  const { data, error } = await need()
    .from('rooms')
    .select('*')
    .eq('owner_id', uid)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Room[]
}

export async function closeRoom(roomId: string) {
  const { error } = await need()
    .from('rooms')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', roomId)
  if (error) throw error
}

// ─── Moderation ─────────────────────────────────────────────────────────────

export async function setQuestionStatus(id: string, status: QuestionStatus) {
  const { error } = await need()
    .from('questions')
    .update({ status, answered_at: status === 'answered' ? new Date().toISOString() : null })
    .eq('id', id)
  if (error) throw error
}

/** Tell students to drop a hidden question (RLS hides the UPDATE from them). */
export async function broadcastHidden(channel: RealtimeChannel | null, id: string) {
  if (!channel) return
  await channel.send({ type: 'broadcast', event: 'question_hidden', payload: { id } })
}

// ─── Polls ──────────────────────────────────────────────────────────────────

export async function createPoll(roomId: string, prompt: string, options: string[]): Promise<string> {
  const { data, error } = await need().rpc('create_poll', {
    p_room_id: roomId,
    p_prompt: prompt,
    p_options: options,
  })
  if (error) throw error
  return data as string
}

export async function closePoll(pollId: string) {
  const { error } = await need()
    .from('polls')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', pollId)
  if (error) throw error
}

// ─── Sorting ────────────────────────────────────────────────────────────────

export function byVotes(a: Question, b: Question) {
  return b.vote_count - a.vote_count || a.created_at.localeCompare(b.created_at)
}

// ─── Live room hook ─────────────────────────────────────────────────────────

export type LiveRoom = {
  loading: boolean
  /** Set when the room code does not exist or the first load failed. */
  error: string | null
  room: Room | null
  questions: Question[]
  polls: Poll[]
  options: PollOption[]
  /** id → nickname; empty unless `owner` mode and RLS allows it. */
  nicknames: Record<string, string>
  /** null when the viewer may not count participants (anon projector). */
  participantCount: number | null
  channel: RealtimeChannel | null
  refresh: () => void
  /** Optimistic local patch, e.g. after a moderation action. */
  patchQuestion: (id: string, patch: Partial<Question>) => void
}

function upsert<T extends { id: string }>(list: T[], row: T): T[] {
  const i = list.findIndex((x) => x.id === row.id)
  if (i === -1) return [...list, row]
  const next = list.slice()
  next[i] = { ...list[i], ...row }
  return next
}

/**
 * Snapshot + realtime for one room, on channel `room:<room_id>`.
 * `owner` mode also loads participant_id and nicknames (instructor console).
 * The projector uses the anon-safe question columns so it works signed in or not.
 */
export function useLiveRoom(code: string, mode: 'owner' | 'present'): LiveRoom {
  const [loading, setLoading] = useState(supabase !== null)
  const [error, setError] = useState<string | null>(supabase ? null : 'Supabase is not configured.')
  const [room, setRoom] = useState<Room | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [polls, setPolls] = useState<Poll[]>([])
  const [options, setOptions] = useState<PollOption[]>([])
  const [nicknames, setNicknames] = useState<Record<string, string>>({})
  const [participantCount, setParticipantCount] = useState<number | null>(null)
  const [channel, setChannel] = useState<RealtimeChannel | null>(null)
  const roomIdRef = useRef<string | null>(null)
  const pollIdsRef = useRef<Set<string>>(new Set())
  const nickRef = useRef<Record<string, string>>({})

  const loadParticipants = useCallback(async (roomId: string) => {
    if (!supabase) return
    if (mode === 'owner') {
      const { data, error } = await supabase.from('participants').select('id,nickname').eq('room_id', roomId)
      if (error) return
      const map: Record<string, string> = {}
      for (const p of data as { id: string; nickname: string }[]) map[p.id] = p.nickname
      nickRef.current = map
      setNicknames(map)
      setParticipantCount(data.length)
    } else {
      // anon has no grant on participants → error → count stays hidden
      const { count, error } = await supabase
        .from('participants')
        .select('id', { count: 'exact', head: true })
        .eq('room_id', roomId)
      setParticipantCount(error ? null : (count ?? 0))
    }
  }, [mode])

  const loadSnapshot = useCallback(
    async (roomId: string) => {
      if (!supabase) return
      const [r, q, p] = await Promise.all([
        supabase.from('rooms').select('*').eq('id', roomId).maybeSingle(),
        supabase
          .from('questions')
          .select(mode === 'owner' ? QUESTION_COLS_OWNER : QUESTION_COLS_ANON)
          .eq('room_id', roomId),
        supabase.from('polls').select('*').eq('room_id', roomId).order('created_at', { ascending: true }),
      ])
      if (r.data) setRoom(r.data as Room)
      if (!q.error) setQuestions((q.data ?? []) as unknown as Question[])
      if (!p.error) {
        const pollRows = (p.data ?? []) as Poll[]
        setPolls(pollRows)
        pollIdsRef.current = new Set(pollRows.map((x) => x.id))
        if (pollRows.length) {
          const o = await supabase
            .from('poll_options')
            .select('*')
            .in('poll_id', pollRows.map((x) => x.id))
            .order('position', { ascending: true })
          if (!o.error) setOptions((o.data ?? []) as PollOption[])
        } else {
          setOptions([])
        }
      }
      void loadParticipants(roomId)
    },
    [mode, loadParticipants],
  )

  const refresh = useCallback(() => {
    if (roomIdRef.current) void loadSnapshot(roomIdRef.current)
  }, [loadSnapshot])

  const patchQuestion = useCallback((id: string, patch: Partial<Question>) => {
    setQuestions((list) => list.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  }, [])

  useEffect(() => {
    const sb = supabase
    if (!sb) return
    let alive = true
    let ch: RealtimeChannel | null = null
    let timer: number | undefined
    const onVisible = () => {
      if (document.visibilityState === 'visible' && roomIdRef.current) void loadSnapshot(roomIdRef.current)
    }

    ;(async () => {
      setLoading(true)
      setError(null)
      const { data, error } = await sb.from('rooms').select('*').eq('code', code.toUpperCase()).maybeSingle()
      if (!alive) return
      if (error || !data) {
        setError(error ? friendlyError(error) : 'No room with that code.')
        setLoading(false)
        return
      }
      const r = data as Room
      roomIdRef.current = r.id
      setRoom(r)
      await loadSnapshot(r.id)
      if (!alive) return
      setLoading(false)

      ch = sb
        .channel(`room:${r.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'questions', filter: `room_id=eq.${r.id}` }, (e) => {
          if (e.eventType === 'DELETE') return
          const row = e.new as Question
          if (mode === 'present') delete row.participant_id
          setQuestions((list) => upsert(list, row))
          if (mode === 'owner' && row.participant_id && !(row.participant_id in nickRef.current)) {
            void loadParticipants(r.id)
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'polls', filter: `room_id=eq.${r.id}` }, (e) => {
          if (e.eventType === 'DELETE') return
          const row = e.new as Poll
          const isNew = !pollIdsRef.current.has(row.id)
          pollIdsRef.current.add(row.id)
          setPolls((list) => upsert(list, row))
          if (isNew) {
            // options were inserted in the same transaction, so they are all there now
            void sb
              .from('poll_options')
              .select('*')
              .eq('poll_id', row.id)
              .order('position', { ascending: true })
              .then(({ data }) => {
                if (data) setOptions((list) => (data as PollOption[]).reduce(upsert, list))
              })
          }
        })
        // poll_options has no room_id: listen unfiltered and drop other rooms' polls
        .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_options' }, (e) => {
          if (e.eventType === 'DELETE') return
          const row = e.new as PollOption
          if (!pollIdsRef.current.has(row.poll_id)) return
          setOptions((list) => upsert(list, row))
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${r.id}` }, (e) => {
          setRoom((prev) => ({ ...(prev ?? r), ...(e.new as Room) }))
        })
        // anon projectors never get the hide UPDATE; follow the moderation broadcast
        .on('broadcast', { event: 'question_hidden' }, ({ payload }) => {
          const id = (payload as { id?: string })?.id
          if (id) setQuestions((list) => list.map((q) => (q.id === id ? { ...q, status: 'hidden' } : q)))
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') void loadSnapshot(r.id)
        })
      setChannel(ch)
      timer = window.setInterval(() => void loadSnapshot(r.id), 15_000)
      document.addEventListener('visibilitychange', onVisible)
    })()

    return () => {
      alive = false
      if (timer) window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      if (ch) void sb.removeChannel(ch)
      setChannel(null)
    }
  }, [code, mode, loadSnapshot, loadParticipants])

  return {
    loading,
    error,
    room,
    questions,
    polls,
    options,
    nicknames,
    participantCount,
    channel,
    refresh,
    patchQuestion,
  }
}
