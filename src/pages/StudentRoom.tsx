import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { isSupabaseConfigured } from '../lib/supabase'
import {
  askQuestion,
  clearSavedJoin,
  friendlyError,
  joinRoom,
  loadSavedJoin,
  pollVote,
  saveJoin,
  sortForStudent,
  upvote,
  useStudentRoom,
  type JoinResult,
  type Poll,
  type PollOption,
  type Question,
} from '../lib/student'
import '../styles/student.css'

const MAX_QUESTION = 500
const MAX_NICKNAME = 24

function normaliseCode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase().slice(0, 6)
}

interface Joined extends JoinResult {
  code: string
  nickname: string
}

export default function StudentRoom() {
  const params = useParams()
  const urlCode = normaliseCode(params.code ?? '')
  const navigate = useNavigate()

  const [joined, setJoined] = useState<Joined | null>(null)
  // Silent re-join after a reload: only when we remember a nickname for this code.
  const [rejoining, setRejoining] = useState(() => loadSavedJoin()?.code === urlCode && isSupabaseConfigured)
  const [rejoinError, setRejoinError] = useState<string | null>(null)
  const joinedCode = useRef<string | null>(null)

  useEffect(() => {
    const saved = loadSavedJoin()
    // Already joined this code (e.g. we just fixed the code and moved to its URL).
    if (joinedCode.current === urlCode) return
    if (!isSupabaseConfigured || !saved || saved.code !== urlCode) {
      setRejoining(false)
      return
    }
    let active = true
    setRejoining(true)
    joinRoom(saved.code, saved.nickname)
      .then((res) => {
        if (!active) return
        joinedCode.current = saved.code
        setJoined({ ...res, code: saved.code, nickname: saved.nickname })
      })
      .catch((err) => active && setRejoinError(friendlyError(err)))
      .finally(() => active && setRejoining(false))
    return () => {
      active = false
    }
  }, [urlCode])

  if (rejoining) {
    return (
      <main className="student">
        <p className="student-center muted">Joining {urlCode}…</p>
      </main>
    )
  }

  if (!joined) {
    return (
      <JoinScreen
        initialCode={urlCode}
        initialNickname={loadSavedJoin()?.nickname ?? ''}
        initialError={rejoinError}
        onJoined={(j) => {
          saveJoin({ code: j.code, nickname: j.nickname })
          joinedCode.current = j.code
          setJoined(j)
          if (j.code !== urlCode) navigate(`/r/${j.code}`, { replace: true })
        }}
      />
    )
  }

  return (
    <RoomScreen
      joined={joined}
      onLeave={() => {
        clearSavedJoin()
        joinedCode.current = null
        setRejoinError(null)
        setJoined(null)
      }}
    />
  )
}

// ─── Join ──────────────────────────────────────────────────────────────────

function JoinScreen({
  initialCode,
  initialNickname,
  initialError,
  onJoined,
}: {
  initialCode: string
  initialNickname: string
  initialError: string | null
  onJoined: (j: Joined) => void
}) {
  const [code, setCode] = useState(initialCode)
  const [nickname, setNickname] = useState(initialNickname)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(initialError)

  const trimmedNick = nickname.trim()
  const canJoin = code.length === 6 && trimmedNick.length >= 1 && trimmedNick.length <= MAX_NICKNAME && !busy

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!canJoin) return
    setBusy(true)
    setError(null)
    try {
      const res = await joinRoom(code, trimmedNick)
      onJoined({ ...res, code, nickname: trimmedNick })
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <main className="student">
      <form className="card stack student-join" onSubmit={submit}>
        <h1>Join the class</h1>
        <label className="stack student-field">
          <span>Room code</span>
          <input
            className="input student-code-input"
            value={code}
            onChange={(e) => setCode(normaliseCode(e.target.value))}
            maxLength={6}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            aria-describedby="code-help"
          />
          <span id="code-help" className="student-note">
            The 6 letters on the classroom screen
          </span>
        </label>
        <label className="stack student-field">
          <span>Nickname</span>
          <input
            className="input"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={MAX_NICKNAME}
            placeholder="Anything you like"
            autoComplete="nickname"
            autoFocus={code.length === 6}
          />
          <span className="student-note">Your nickname is never shown next to your questions.</span>
        </label>
        <button className="button student-big-button" type="submit" disabled={!canJoin}>
          {busy ? 'Joining…' : 'Join'}
        </button>
        <p className="student-chip">No account needed. Ask in any language.</p>
        {error && (
          <p className="student-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </main>
  )
}

// ─── Room ──────────────────────────────────────────────────────────────────

function RoomScreen({ joined, onLeave }: { joined: Joined; onLeave: () => void }) {
  const live = useStudentRoom(joined.room_id)
  const title = live.room?.title ?? joined.title
  const closed = (live.room?.status ?? joined.status) === 'closed'
  const visible = sortForStudent(live.questions.filter((q) => q.status !== 'hidden'))

  useEffect(() => {
    document.title = `${title} · TSI Classroom Live`
  }, [title])

  return (
    <main className="student">
      <header className="student-header">
        <div className="student-header-top">
          <h1 className="student-title">{title}</h1>
          <span className={`student-live ${live.live ? 'is-live' : ''}`} role="status">
            <span className="student-dot" aria-hidden="true" />
            {live.live ? 'live' : 'reconnecting…'}
          </span>
        </div>
        <p className="student-meta">
          <span className="student-code">{joined.code}</span> · you are “{joined.nickname}” (only you see this) ·{' '}
          <button type="button" className="student-link" onClick={onLeave}>
            Leave
          </button>
        </p>
        <p className="student-note">Questions are anonymous. No one sees your name.</p>
      </header>

      {closed && (
        <div className="student-ended" role="status">
          This session has ended. Thanks for asking!
        </div>
      )}

      {!closed && <AskBox roomId={joined.room_id} onAsked={live.refetch} />}

      {live.poll && (
        <PollCard
          poll={live.poll}
          options={live.options}
          voted={live.votedPolls.has(live.poll.id)}
          roomClosed={closed}
          onVoted={(on) => live.markPollVoted(live.poll!.id, on)}
          onChanged={live.refetch}
        />
      )}

      <section className="stack" aria-labelledby="questions-heading">
        <h2 id="questions-heading" className="student-h2">
          Questions
        </h2>
        {visible.length === 0 ? (
          <p className="student-empty">No questions yet. Be the first. Any language is fine.</p>
        ) : (
          <ul className="student-questions">
            {visible.map((q) => (
              <QuestionRow
                key={q.id}
                question={q}
                voted={live.votedQuestions.has(q.id)}
                disabled={closed}
                onVoted={(on) => live.markQuestionVoted(q.id, on)}
                onChanged={live.refetch}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function AskBox({ roomId, onAsked }: { roomId: string; onAsked: () => void }) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const length = body.trim().length

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (length === 0 || length > MAX_QUESTION || busy) return
    setBusy(true)
    setMessage(null)
    try {
      await askQuestion(roomId, body)
      setBody('')
      setMessage({ kind: 'ok', text: 'Sent!' })
      onAsked()
    } catch (err) {
      setMessage({ kind: 'error', text: friendlyError(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card stack student-ask" onSubmit={submit}>
      <label htmlFor="ask-body" className="sr-only">
        Your question
      </label>
      <textarea
        id="ask-body"
        className="input student-textarea"
        rows={3}
        value={body}
        maxLength={MAX_QUESTION}
        onChange={(e) => {
          setBody(e.target.value)
          if (message?.kind === 'ok') setMessage(null)
        }}
        placeholder="Ask in English, Nepali or mixed — it's okay"
      />
      <div className="student-ask-row">
        <span className={`student-counter ${body.length >= MAX_QUESTION ? 'is-full' : ''}`}>
          {body.length}/{MAX_QUESTION}
        </span>
        <button className="button" type="submit" disabled={length === 0 || busy}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
      {message && (
        <p className={message.kind === 'error' ? 'student-error' : 'student-ok'} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </form>
  )
}

function PollCard({
  poll,
  options,
  voted,
  roomClosed,
  onVoted,
  onChanged,
}: {
  poll: Poll
  options: PollOption[]
  voted: boolean
  roomClosed: boolean
  onVoted: (on: boolean) => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const open = poll.status === 'open' && !roomClosed
  const showResults = voted || !open
  const total = options.reduce((sum, o) => sum + o.vote_count, 0)

  async function choose(optionId: string) {
    if (busy || voted || !open) return
    setBusy(true)
    setError(null)
    onVoted(true)
    try {
      await pollVote(optionId)
      onChanged()
    } catch (err) {
      onVoted(false)
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack student-poll" aria-labelledby="poll-prompt">
      <p className="student-note">{open ? 'Live poll · one vote' : 'Poll closed'}</p>
      <h2 id="poll-prompt" className="student-poll-prompt">
        {poll.prompt}
      </h2>
      {showResults ? (
        <ul className="student-bars">
          {options.map((o) => {
            const pct = total ? Math.round((o.vote_count / total) * 100) : 0
            return (
              <li key={o.id} className="student-bar">
                <span className="student-bar-fill" style={{ width: `${pct}%` }} />
                <span className="student-bar-label">
                  <span>{o.label}</span>
                  <span>
                    {o.vote_count} · {pct}%
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="stack student-options">
          {options.map((o) => (
            <button key={o.id} type="button" className="button button-secondary student-option" disabled={busy} onClick={() => choose(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
      {showResults && (
        <p className="student-note">
          {voted ? 'You voted. ' : ''}
          {total} {total === 1 ? 'vote' : 'votes'}
          {open ? '' : ' · voting closed'}
        </p>
      )}
      {error && (
        <p className="student-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function QuestionRow({
  question,
  voted,
  disabled,
  onVoted,
  onChanged,
}: {
  question: Question
  voted: boolean
  disabled: boolean
  onVoted: (on: boolean) => void
  onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const answered = question.status === 'answered'
  const canVote = !answered && !disabled

  async function vote() {
    if (voted || !canVote) return // a second tap does nothing
    setError(null)
    onVoted(true)
    try {
      await upvote(question.id)
      onChanged()
    } catch (err) {
      onVoted(false)
      setError(friendlyError(err))
    }
  }

  return (
    <li className={`student-q ${answered ? 'is-answered' : ''}`}>
      <button
        type="button"
        className={`student-upvote ${voted ? 'is-voted' : ''}`}
        onClick={vote}
        disabled={!canVote && !voted}
        aria-pressed={voted}
        aria-label={voted ? `You upvoted this. ${question.vote_count} votes` : `Upvote. ${question.vote_count} votes`}
      >
        <span aria-hidden="true">▲</span>
        <span>{question.vote_count}</span>
      </button>
      <div className="student-q-main">
        <p className="student-q-body">{question.body}</p>
        {answered && <p className="student-answered">✓ Answered</p>}
        {error && (
          <p className="student-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </li>
  )
}
