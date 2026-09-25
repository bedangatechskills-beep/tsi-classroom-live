import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { byVotes, useLiveRoom, type PollOption } from '../lib/instructor'
import '../styles/instructor.css'

export default function Present() {
  const { code: rawCode = '' } = useParams()
  const code = rawCode.toUpperCase()
  const joinUrl = `${window.location.origin}/r/${code}`
  const [qr, setQr] = useState<string | null>(null)
  const live = useLiveRoom(code, 'present')

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(joinUrl, { width: 720, margin: 1, color: { dark: '#102844', light: '#ffffff' } })
      .then((dataUrl) => {
        if (!cancelled) setQr(dataUrl)
      })
      .catch(() => {
        if (!cancelled) setQr(null)
      })
    return () => {
      cancelled = true
    }
  }, [joinUrl])

  // Signed in as owner the projector also receives hidden rows: show open questions only. No nicknames, ever.
  const open = useMemo(() => live.questions.filter((q) => q.status === 'open').sort(byVotes), [live.questions])

  // Latest poll: live while open, final bars once closed (kept until the next poll).
  const poll = useMemo(
    () => [...live.polls].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null,
    [live.polls],
  )
  const pollOptions = poll
    ? live.options.filter((o) => o.poll_id === poll.id).sort((a, b) => a.position - b.position)
    : []

  const room = live.room
  const ended = room?.status === 'closed'

  if (ended) {
    return (
      <main className="projector">
        <p className="projector-kicker">{room.title}</p>
        <h1 className="present-ended">Session ended</h1>
        <p className="projector-url">
          {open.length} question{open.length === 1 ? '' : 's'} carried to next class
        </p>
      </main>
    )
  }

  return (
    <main className="projector present">
      <aside className="present-side">
        <p className="present-join">Join at {window.location.host}/r</p>
        <div className="projector-code present-code" aria-label={`Room code ${code.split('').join(' ')}`}>
          {code}
        </div>
        {qr && <img className="projector-qr" src={qr} alt={`QR code for ${joinUrl}`} />}
        <p className="projector-url">{joinUrl}</p>
        {live.participantCount !== null && (
          <p className="present-count">
            {live.participantCount} joined
          </p>
        )}
      </aside>

      <section className="present-main">
        {live.error && <p className="present-empty">{live.error}</p>}
        {room && <h1 className="present-title">{room.title}</h1>}

        {poll && <PresentPoll prompt={poll.prompt} closed={poll.status === 'closed'} options={pollOptions} />}

        {!live.loading && !live.error && open.length === 0 && (
          <p className="present-empty">No questions yet — scan the code and ask the first one.</p>
        )}
        <ol className="present-questions">
          {open.map((q) => (
            <li key={q.id} className="present-q">
              <span className="present-votes" aria-label={`${q.vote_count} votes`}>
                ▲ {q.vote_count}
              </span>
              <span className="present-body">{q.body}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}

function PresentPoll({ prompt, closed, options }: { prompt: string; closed: boolean; options: PollOption[] }) {
  const total = options.reduce((s, o) => s + o.vote_count, 0)
  return (
    <div className="present-poll">
      <div className="present-poll-head">
        <span className={`present-poll-tag ${closed ? 'is-closed' : ''}`}>{closed ? 'Poll closed' : 'Live poll'}</span>
        <h2>{prompt}</h2>
      </div>
      <ul className="present-bars">
        {options.map((o) => {
          const pct = total ? Math.round((o.vote_count / total) * 100) : 0
          return (
            <li key={o.id}>
              <div className="present-bar-label">
                <span>{o.label}</span>
                <span className="present-bar-num">{pct}%</span>
              </div>
              <div className="present-bar-track">
                <div className="present-bar-fill" style={{ width: `${pct}%` }} />
              </div>
            </li>
          )
        })}
      </ul>
      <p className="present-poll-total">
        {total} answer{total === 1 ? '' : 's'}
      </p>
    </div>
  )
}
