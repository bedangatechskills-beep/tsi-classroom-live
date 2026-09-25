import { useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  broadcastHidden,
  byVotes,
  closePoll,
  closeRoom,
  createPoll,
  friendlyError,
  setQuestionStatus,
  signInWithGitHub,
  useLiveRoom,
  useSession,
  type Poll,
  type PollOption,
  type Question,
  type QuestionStatus,
} from '../lib/instructor'
import { downloadRecap } from '../lib/recap'
import '../styles/instructor.css'

const TABS: { key: QuestionStatus; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'answered', label: 'Answered' },
  { key: 'hidden', label: 'Hidden' },
]

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export default function InstructorRoom() {
  const { code = '' } = useParams()
  const session = useSession()

  if (session === undefined) {
    return (
      <main className="page">
        <p className="muted">Loading…</p>
      </main>
    )
  }
  if (session === null) {
    return (
      <main className="page stack">
        <h1>
          Room <span className="accent">{code.toUpperCase()}</span>
        </h1>
        <section className="card stack">
          <p>Sign in as the room's instructor to open the console.</p>
          <div>
            <button className="button" onClick={() => void signInWithGitHub()}>
              Sign in with GitHub
            </button>
          </div>
        </section>
      </main>
    )
  }
  return <Console code={code} uid={session.user.id} />
}

function Console({ code, uid }: { code: string; uid: string }) {
  const live = useLiveRoom(code, 'owner')
  const { room, questions, nicknames } = live
  const [tab, setTab] = useState<QuestionStatus>('open')
  const [confirmClose, setConfirmClose] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const grouped = useMemo(() => {
    const g: Record<QuestionStatus, Question[]> = { open: [], answered: [], hidden: [] }
    for (const q of questions) g[q.status]?.push(q)
    g.open.sort(byVotes)
    g.answered.sort((a, b) => (b.answered_at ?? '').localeCompare(a.answered_at ?? ''))
    g.hidden.sort(byVotes)
    return g
  }, [questions])

  if (live.loading) {
    return (
      <main className="page">
        <p className="muted">Loading room…</p>
      </main>
    )
  }
  if (live.error || !room) {
    return (
      <main className="page stack">
        <h1>Room {code.toUpperCase()}</h1>
        <p className="alert">{live.error ?? 'Room not found.'}</p>
        <Link to="/">Back to my rooms</Link>
      </main>
    )
  }
  if (room.owner_id !== uid) {
    return (
      <main className="page stack">
        <h1>
          Room <span className="accent">{room.code}</span>
        </h1>
        <section className="card stack">
          <p>This room belongs to another instructor, so its console isn't available to you.</p>
          <p className="muted">
            Students join at <Link to={`/r/${room.code}`}>/r/{room.code}</Link>.
          </p>
          <Link to="/">Back to my rooms</Link>
        </section>
      </main>
    )
  }

  const closed = room.status === 'closed'

  async function act(fn: () => Promise<unknown>) {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(friendlyError(e))
      live.refresh()
    }
  }

  function moderate(q: Question, status: QuestionStatus) {
    const answered_at = status === 'answered' ? new Date().toISOString() : null
    live.patchQuestion(q.id, { status, answered_at })
    void act(async () => {
      await setQuestionStatus(q.id, status)
      if (status === 'hidden') await broadcastHidden(live.channel, q.id)
    })
  }

  return (
    <main className="page console stack stack-lg">
      <header className="console-top card">
        <div className="stack console-id">
          <Link to="/" className="small">
            ← My rooms
          </Link>
          <div className="row">
            <span className="room-code room-code-lg">{room.code}</span>
            <span className={`badge badge-${room.status}`}>{closed ? 'Closed' : 'Open'}</span>
          </div>
          <h1 className="console-title">{room.title}</h1>
          <p className="muted">
            {live.participantCount ?? 0} participant{live.participantCount === 1 ? '' : 's'} · {grouped.open.length} open
            question{grouped.open.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="row console-actions">
          <a className="button button-secondary" href={`/present/${room.code}`} target="_blank" rel="noopener">
            Open projector
          </a>
          <button className="button button-secondary" onClick={() => downloadRecap(room, questions)}>
            Export recap (.md)
          </button>
          {!closed && !confirmClose && (
            <button className="button button-danger-outline" onClick={() => setConfirmClose(true)}>
              Close room
            </button>
          )}
        </div>
        {confirmClose && !closed && (
          <div className="confirm" role="alertdialog" aria-label="Confirm close room">
            <p>
              <strong>Close this room?</strong> Students can no longer ask, vote or answer polls.
            </p>
            <div className="row">
              <button
                className="button button-danger"
                onClick={() =>
                  void act(async () => {
                    await closeRoom(room.id)
                    setConfirmClose(false)
                    live.refresh()
                  })
                }
              >
                Yes, close room
              </button>
              <button className="button button-secondary" onClick={() => setConfirmClose(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </header>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      {closed && (
        <section className="card recap-callout stack">
          <h2>Room closed</h2>
          <p>
            {grouped.open.length} unanswered question{grouped.open.length === 1 ? '' : 's'} to carry to the next class.
          </p>
          <div>
            <button className="button" onClick={() => downloadRecap(room, questions)}>
              Download recap (.md)
            </button>
          </div>
        </section>
      )}

      <div className="console-grid">
        <section className="stack">
          <div className="tabs" role="tablist" aria-label="Questions">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={`tab ${tab === t.key ? 'tab-active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label} <span className="tab-count">{grouped[t.key].length}</span>
              </button>
            ))}
          </div>
          {grouped[tab].length === 0 && (
            <p className="muted empty">
              {tab === 'open' ? 'No open questions yet. They appear here live.' : `No ${tab} questions.`}
            </p>
          )}
          <ul className="q-list">
            {grouped[tab].map((q) => (
              <li key={q.id} className={`card q-item q-${q.status}`}>
                <div className="q-votes" aria-label={`${q.vote_count} votes`}>
                  {q.vote_count}
                </div>
                <div className="q-main">
                  <p className="q-body">{q.body}</p>
                  <p className="muted small">
                    {(q.participant_id && nicknames[q.participant_id]) || 'Student'} · {timeOf(q.created_at)}
                  </p>
                </div>
                <div className="q-actions">
                  {q.status === 'open' ? (
                    <>
                      <button className="button button-sm" onClick={() => moderate(q, 'answered')}>
                        Mark answered
                      </button>
                      <button className="button button-secondary button-sm" onClick={() => moderate(q, 'hidden')}>
                        Hide
                      </button>
                    </>
                  ) : (
                    <button className="button button-secondary button-sm" onClick={() => moderate(q, 'open')}>
                      Undo
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <PollPanel
          roomId={room.id}
          closed={closed}
          polls={live.polls}
          options={live.options}
          onError={setError}
          onChange={live.refresh}
        />
      </div>
    </main>
  )
}

function PollBars({ options }: { options: PollOption[] }) {
  const total = options.reduce((s, o) => s + o.vote_count, 0)
  return (
    <ul className="bars">
      {options.map((o) => {
        const pct = total ? Math.round((o.vote_count / total) * 100) : 0
        return (
          <li key={o.id} className="bar">
            <div className="bar-label">
              <span>{o.label}</span>
              <span className="bar-count">
                {o.vote_count} · {pct}%
              </span>
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${pct}%` }} />
            </div>
          </li>
        )
      })}
      <li className="muted small">
        {total} answer{total === 1 ? '' : 's'}
      </li>
    </ul>
  )
}

function PollPanel({
  roomId,
  closed,
  polls,
  options,
  onError,
  onChange,
}: {
  roomId: string
  closed: boolean
  polls: Poll[]
  options: PollOption[]
  onError: (msg: string | null) => void
  onChange: () => void
}) {
  const [prompt, setPrompt] = useState('')
  const [choices, setChoices] = useState(['', ''])
  const [busy, setBusy] = useState(false)

  const optionsOf = (id: string) => options.filter((o) => o.poll_id === id).sort((a, b) => a.position - b.position)
  const sorted = [...polls].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const current = sorted.find((p) => p.status === 'open') ?? null
  const past = sorted.filter((p) => p !== current)

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    onError(null)
    try {
      await createPoll(
        roomId,
        prompt,
        choices.map((c) => c.trim()).filter(Boolean),
      )
      setPrompt('')
      setChoices(['', ''])
      onChange()
    } catch (err) {
      onError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onClose(pollId: string) {
    onError(null)
    try {
      await closePoll(pollId)
      onChange()
    } catch (err) {
      onError(friendlyError(err))
    }
  }

  const filled = choices.filter((c) => c.trim()).length

  return (
    <section className="stack poll-panel">
      <h2>Polls</h2>

      {current && (
        <div className="card stack">
          <div className="row poll-head">
            <strong className="poll-prompt">{current.prompt}</strong>
            <span className="badge badge-open">Live</span>
          </div>
          <PollBars options={optionsOf(current.id)} />
          <div>
            <button className="button button-secondary button-sm" onClick={() => void onClose(current.id)}>
              Close poll
            </button>
          </div>
        </div>
      )}

      {!closed && (
        <form className="card stack" onSubmit={onCreate}>
          <h3>{current ? 'Start another poll' : 'New poll'}</h3>
          <label className="stack field">
            <span className="small muted">Question</span>
            <input
              className="input"
              value={prompt}
              maxLength={200}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Is the pace OK?"
              required
            />
          </label>
          {choices.map((c, i) => (
            <div key={i} className="row option-row">
              <input
                className="input"
                value={c}
                maxLength={80}
                aria-label={`Option ${i + 1}`}
                placeholder={`Option ${i + 1}`}
                onChange={(e) => setChoices(choices.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {choices.length > 2 && (
                <button
                  type="button"
                  className="button button-secondary button-sm"
                  aria-label={`Remove option ${i + 1}`}
                  onClick={() => setChoices(choices.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <div className="row">
            {choices.length < 4 && (
              <button type="button" className="button button-secondary button-sm" onClick={() => setChoices([...choices, ''])}>
                + Add option
              </button>
            )}
            <button className="button" disabled={busy || !prompt.trim() || filled < 2}>
              {busy ? 'Starting…' : 'Start poll'}
            </button>
          </div>
        </form>
      )}

      {past.length > 0 && (
        <details className="card past-polls">
          <summary>Past polls ({past.length})</summary>
          <div className="stack">
            {past.map((p) => (
              <div key={p.id} className="stack past-poll">
                <strong>{p.prompt}</strong>
                <PollBars options={optionsOf(p.id)} />
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
