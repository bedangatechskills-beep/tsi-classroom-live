export default function Home() {
  return (
    <main className="page stack stack-lg">
      <header className="stack">
        <h1>TSI Classroom Live</h1>
        <p className="muted">Live questions, upvotes and polls for your class.</p>
      </header>
      <section className="card stack">
        <h2>Instructor home</h2>
        <ul className="todo">
          <li>TODO: Sign in with GitHub (Supabase Auth)</li>
          <li>TODO: List my rooms (open and closed)</li>
          <li>TODO: Create a room with a title (create_room RPC)</li>
          <li>TODO: Open a room's console or projector view</li>
        </ul>
      </section>
    </main>
  )
}
