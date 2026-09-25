import { useParams } from 'react-router-dom'

export default function InstructorRoom() {
  const { code = '' } = useParams()
  return (
    <main className="page stack stack-lg">
      <h1>
        Room <span className="accent">{code.toUpperCase()}</span>
      </h1>
      <section className="card stack">
        <h2>Instructor console</h2>
        <ul className="todo">
          <li>TODO: Live question list sorted by votes</li>
          <li>TODO: Moderate questions (mark answered, hide)</li>
          <li>TODO: See student nicknames</li>
          <li>TODO: Create, open and close polls with live results</li>
          <li>TODO: Close the room and show a recap</li>
        </ul>
      </section>
    </main>
  )
}
