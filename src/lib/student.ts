import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { getDeviceSecret } from './device'

// Anon has column-level SELECT on questions: never select('*') here.
const QUESTION_COLUMNS = 'id,room_id,body,status,vote_count,created_at,answered_at'
const ROOM_COLUMNS = 'id,code,title,status'
const POLL_COLUMNS = 'id,room_id,prompt,status,created_at,closed_at'
const OPTION_COLUMNS = 'id,poll_id,label,position,vote_count'
const SAFETY_REFETCH_MS = 15_000

export type QuestionStatus = 'open' | 'answered' | 'hidden'

export interface Question {
  id: string
  room_id: string
  body: string
  status: QuestionStatus
  vote_count: number
  created_at: string
  answered_at: string | null
}

export interface RoomInfo {
  id: string
  code: string
  title: string
  status: 'open' | 'closed'
}

export interface Poll {
  id: string
  room_id: string
  prompt: string
  status: 'open' | 'closed'
  created_at: string
  closed_at: string | null
}

export interface PollOption {
  id: string
  poll_id: string
  label: string
  position: number
  vote_count: number
}

export interface JoinResult {
  participant_id: string
  room_id: string
  title: string
  status: 'open' | 'closed'
}

// ─── Errors ────────────────────────────────────────────────────────────────

const FRIENDLY: Record<string, string> = {
  'room not found or closed': "That room code isn't open. Check the code on the screen.",
  'slow down': 'Wait a few seconds before the next one',
  'nickname must be 1–24 characters': 'Pick a nickname of 1 to 24 characters.',
  'question must be 1–500 characters': 'A question can be 1 to 500 characters.',
  'not allowed': "That didn't go through. The room may have closed. Try reloading.",
}

/** Turns an RPC error into text a student can act on. */
export function friendlyError(err: unknown): string {
  const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err)
  const known = Object.keys(FRIENDLY).find((k) => message.includes(k))
  if (known) return FRIENDLY[known]
  if (/fetch|network|timeout/i.test(message)) return 'No connection. Check your internet and try again.'
  return 'Something went wrong. Please try again.'
}

function client() {
  if (!supabase) throw new Error('The app is not connected to a database yet.')
  return supabase
}

// ─── RPC wrappers (every student write goes through these) ─────────────────

export async function joinRoom(code: string, nickname: string): Promise<JoinResult> {
  const { data, error } = await client().rpc('join_room', {
    p_code: code,
    p_nickname: nickname,
    p_secret: getDeviceSecret(),
  })
  if (error) throw error
  return data as JoinResult
}

export async function askQuestion(roomId: string, body: string): Promise<string> {
  const { data, error } = await client().rpc('ask_question', {
    p_room_id: roomId,
    p_secret: getDeviceSecret(),
    p_body: body,
  })
  if (error) throw error
  return data as string
}

export async function upvote(questionId: string): Promise<void> {
  const { error } = await client().rpc('vote', { p_question_id: questionId, p_secret: getDeviceSecret() })
  if (error) throw error
}

export async function pollVote(optionId: string): Promise<void> {
  const { error } = await client().rpc('poll_vote', { p_option_id: optionId, p_secret: getDeviceSecret() })
  if (error) throw error
}

interface MyState {
  question_ids_voted: string[]
  poll_ids_voted: string[]
}

async function fetchMyState(roomId: string): Promise<MyState> {
  const { data, error } = await client().rpc('my_state', { p_room_id: roomId, p_secret: getDeviceSecret() })
  if (error) throw error
  return data as MyState
}

// ─── Remembered join (so a reload re-joins silently) ───────────────────────

const JOIN_KEY = 'tsi-cl-join'

export interface SavedJoin {
  code: string
  nickname: string
}

export function loadSavedJoin(): SavedJoin | null {
  try {
    const raw = localStorage.getItem(JOIN_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SavedJoin>
    return typeof parsed.code === 'string' && typeof parsed.nickname === 'string'
      ? { code: parsed.code, nickname: parsed.nickname }
      : null
  } catch {
    return null
  }
}

export function saveJoin(join: SavedJoin): void {
  try {
    localStorage.setItem(JOIN_KEY, JSON.stringify(join))
  } catch {
    // Storage blocked: the student just re-enters the nickname after a reload.
  }
}

export function clearSavedJoin(): void {
  try {
    localStorage.removeItem(JOIN_KEY)
  } catch {
    // ignore
  }
}

// ─── Sorting ───────────────────────────────────────────────────────────────

/** Open questions first, then answered; each by votes desc, then oldest first. */
export function sortForStudent(questions: Question[]): Question[] {
  return [...questions].sort(
    (a, b) =>
      Number(a.status === 'answered') - Number(b.status === 'answered') ||
      b.vote_count - a.vote_count ||
      a.created_at.localeCompare(b.created_at),
  )
}

// ─── Live room hook ────────────────────────────────────────────────────────

export interface LiveRoom {
  room: RoomInfo | null
  questions: Question[]
  poll: Poll | null
  options: PollOption[]
  votedQuestions: Set<string>
  votedPolls: Set<string>
  live: boolean
  refetch: () => void
  markQuestionVoted: (id: string, voted: boolean) => void
  markPollVoted: (id: string, voted: boolean) => void
}

function upsertById<T extends { id: string }>(list: T[], row: T): T[] {
  const i = list.findIndex((x) => x.id === row.id)
  if (i === -1) return [...list, row]
  const next = list.slice()
  next[i] = row
  return next
}

function toggle(set: Set<string>, id: string, on: boolean): Set<string> {
  if (set.has(id) === on) return set
  const next = new Set(set)
  if (on) next.add(id)
  else next.delete(id)
  return next
}

/**
 * Everything the student page shows for one room, kept live:
 * one channel `room:<roomId>` (postgres_changes + the `question_hidden` broadcast),
 * plus a full snapshot refetch on SUBSCRIBED, on returning to the tab, and every 15 s.
 */
export function useStudentRoom(roomId: string | null): LiveRoom {
  const [room, setRoom] = useState<RoomInfo | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [poll, setPoll] = useState<Poll | null>(null)
  const [options, setOptions] = useState<PollOption[]>([])
  const [votedQuestions, setVotedQuestions] = useState<Set<string>>(new Set())
  const [votedPolls, setVotedPolls] = useState<Set<string>>(new Set())
  const [live, setLive] = useState(false)

  const pollIdRef = useRef<string | null>(null)
  const fetchSeq = useRef(0)
  const refetchRef = useRef<() => void>(() => {})

  useEffect(() => {
    const sb = supabase
    if (!sb || !roomId) return
    let cancelled = false
    let channel: RealtimeChannel | null = null

    const refetch = async () => {
      const seq = ++fetchSeq.current
      const [roomRes, qRes, pollRes, mine] = await Promise.all([
        sb.from('rooms').select(ROOM_COLUMNS).eq('id', roomId).maybeSingle(),
        sb.from('questions').select(QUESTION_COLUMNS).eq('room_id', roomId).neq('status', 'hidden'),
        sb.from('polls').select(POLL_COLUMNS).eq('room_id', roomId).order('created_at', { ascending: false }).limit(1),
        fetchMyState(roomId).catch(() => null),
      ])
      const latestPoll = (pollRes.data?.[0] as Poll | undefined) ?? null
      const optRes = latestPoll
        ? await sb.from('poll_options').select(OPTION_COLUMNS).eq('poll_id', latestPoll.id).order('position')
        : null
      // A newer refetch started while this one was in flight: its result wins.
      if (cancelled || seq !== fetchSeq.current) return

      if (roomRes.data) setRoom(roomRes.data as RoomInfo)
      if (qRes.data) setQuestions(qRes.data as Question[])
      if (!pollRes.error) {
        pollIdRef.current = latestPoll?.id ?? null
        setPoll(latestPoll)
        setOptions((optRes?.data as PollOption[] | undefined) ?? [])
      }
      if (mine) {
        setVotedQuestions(new Set(mine.question_ids_voted))
        setVotedPolls(new Set(mine.poll_ids_voted))
      }
    }
    refetchRef.current = () => void refetch()

    const start = async () => {
      // supabase.channel() hands back an existing channel with the same topic, even one
      // that is still leaving (React StrictMode remount). Wait for it to go first.
      const topic = `realtime:room:${roomId}`
      await Promise.all(sb.getChannels().filter((c) => c.topic === topic).map((c) => sb.removeChannel(c)))
      if (cancelled) return

      channel = sb
        .channel(`room:${roomId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'questions', filter: `room_id=eq.${roomId}` }, (p) => {
          if (p.eventType === 'DELETE') {
            const id = (p.old as Partial<Question>).id
            setQuestions((qs) => qs.filter((q) => q.id !== id))
            return
          }
          const row = p.new as Question
          setQuestions((qs) => (row.status === 'hidden' ? qs.filter((q) => q.id !== row.id) : upsertById(qs, row)))
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'polls', filter: `room_id=eq.${roomId}` }, () => {
          // A new or closed poll: refetch so its options come along with it.
          void refetch()
        })
        // poll_options has no room_id; take everything and keep only the current poll's rows.
        .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_options' }, (p) => {
          const row = p.new as PollOption
          if (!row?.id || row.poll_id !== pollIdRef.current) return
          setOptions((os) => upsertById(os, row).sort((a, b) => a.position - b.position))
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, (p) => {
          setRoom((r) => ({ ...(r ?? {}), ...(p.new as RoomInfo) }))
        })
        .on('broadcast', { event: 'question_hidden' }, ({ payload }) => {
          const id = (payload as { id?: string } | undefined)?.id
          if (id) setQuestions((qs) => qs.filter((q) => q.id !== id))
        })
        .subscribe((status) => {
          if (cancelled) return
          if (status === 'SUBSCRIBED') {
            setLive(true)
            void refetch()
          } else {
            setLive(false)
          }
        })
    }

    void refetch()
    void start()

    const onVisible = () => {
      if (document.visibilityState === 'visible') void refetch()
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => void refetch(), SAFETY_REFETCH_MS)

    return () => {
      cancelled = true
      setLive(false)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
      if (channel) void sb.removeChannel(channel)
    }
  }, [roomId])

  const refetch = useCallback(() => refetchRef.current(), [])
  const markQuestionVoted = useCallback((id: string, on: boolean) => setVotedQuestions((s) => toggle(s, id, on)), [])
  const markPollVoted = useCallback((id: string, on: boolean) => setVotedPolls((s) => toggle(s, id, on)), [])

  return { room, questions, poll, options, votedQuestions, votedPolls, live, refetch, markQuestionVoted, markPollVoted }
}
