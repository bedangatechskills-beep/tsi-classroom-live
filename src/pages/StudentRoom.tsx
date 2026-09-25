import { useParams } from 'react-router-dom'

export default function StudentRoom() {
  const { code = '' } = useParams()
  return (
    <main className="page stack stack-lg">
      <h1>
        Join <span className="accent">{code.toUpperCase()}</span>
      </h1>
      <section className="card stack">
        <h2>Student room</h2>
        <ul className="todo">
          <li>TODO: Pick a nickname and join (device secret, no account)</li>
          <li>TODO: Ask a question</li>
          <li>TODO: Upvote other questions (one vote each)</li>
          <li>TODO: Answer the open poll</li>
        </ul>
      </section>
    </main>
  )
}
