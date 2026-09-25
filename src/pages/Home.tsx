import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { isSupabaseConfigured } from '../lib/supabase'
import {
  createRoom,
  friendlyError,
  listMyRooms,
  signInWithGitHub,
  signOut,
  useSession,
  type Room,
} from '../lib/instructor'
import '../styles/instructor.css'

export default function Home() {
  const session = useSession()
  const navigate = useNavigate()
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const uid = session?.user.id

  useEffect(() => {
    if (!uid) return
    let alive = true
    listMyRooms(uid)
      .then((r) => alive && setRooms(r))
      .catch((e) => alive && setError(friendlyError(e)))
    return () => {
      alive = false
    }
  }, [uid])

  async function onSignIn() {
    setError(null)
    try {
      await signInWithGitHub()
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const room = await createRoom(title)
      navigate(`/room/${room.code}`)
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  const meta = session?.user.user_metadata as { avatar_url?: string; full_name?: string; user_name?: string } | undefined
  const name = meta?.full_name || meta?.user_name || session?.user.email || 'Instructor'

  return (
    <main className="page stack stack-lg">
      <header className="row home-header">
        <div className="stack home-title">
          <h1>TSI Classroom Live</h1>
          <p className="muted home-pitch">No question gets lost.</p>
        </div>
        {session && (
          <div className="row">
            {meta?.avatar_url && <img className="avatar" src={meta.avatar_url} alt="" width={40} height={40} />}
            <strong>{name}</strong>
            <button className="button button-secondary button-sm" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        )}
      </header>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      {session === undefined && <p className="muted">Loading…</p>}

      {session === null && (
        <section className="card stack">
          <h2>Instructor sign-in</h2>
          <p className="muted">
            Open a room, put the code on the projector, and let every student ask and upvote from their phone.
          </p>
          <div>
            <button className="button" onClick={onSignIn} disabled={!isSupabaseConfigured}>
              Sign in with GitHub
            </button>
          </div>
        </section>
      )}

      {session && (
        <>
          <section className="card stack">
            <h2>New room</h2>
            <form className="row new-room" onSubmit={onCreate}>
              <label className="sr-only" htmlFor="room-title">
                Room title
              </label>
              <input
                id="room-title"
                className="input"
                placeholder="e.g. Session 12 — React state"
                value={title}
                maxLength={120}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
              <button className="button" disabled={busy || !title.trim()}>
                {busy ? 'Creating…' : 'Create room'}
              </button>
            </form>
          </section>

          <section className="stack">
            <h2>My rooms</h2>
            {rooms === null && <p className="muted">Loading rooms…</p>}
            {rooms?.length === 0 && <p className="muted">No rooms yet. Create one above.</p>}
            {rooms && rooms.length > 0 && (
              <ul className="room-list">
                {rooms.map((r) => (
                  <li key={r.id} className="card room-item">
                    <span className="room-code">{r.code}</span>
                    <div className="room-main">
                      <strong>{r.title}</strong>
                      <span className="muted small">
                        {new Date(r.created_at).toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                    <span className={`badge badge-${r.status}`}>{r.status === 'open' ? 'Open' : 'Closed'}</span>
                    <div className="row room-links">
                      <Link to={`/room/${r.code}`}>Console</Link>
                      <a href={`/present/${r.code}`} target="_blank" rel="noopener">
                        Projector
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  )
}
