import type { Question, Room } from './instructor'

/** Local calendar date as yyyy-mm-dd. */
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function recapDate(room: Pick<Room, 'created_at' | 'closed_at'>): string {
  return isoDate(new Date(room.closed_at ?? room.created_at))
}

/** Keep each question on one list line; students may paste multi-line text. */
function oneLine(body: string): string {
  return body.replace(/\s*\n\s*/g, ' ').trim()
}

/** Markdown recap: unanswered (open) questions by votes, then answered ones. Hidden are left out. */
export function buildRecap(room: Pick<Room, 'title' | 'code' | 'created_at' | 'closed_at'>, questions: Question[]): string {
  const open = questions
    .filter((q) => q.status === 'open')
    .sort((a, b) => b.vote_count - a.vote_count || a.created_at.localeCompare(b.created_at))
  const answered = questions
    .filter((q) => q.status === 'answered')
    .sort((a, b) => (a.answered_at ?? a.created_at).localeCompare(b.answered_at ?? b.created_at))

  const lines = [
    `# Recap — ${room.title} · room ${room.code} · ${recapDate(room)}`,
    `${open.length} unanswered question${open.length === 1 ? '' : 's'}, most-voted first`,
    '',
  ]
  open.forEach((q, i) => {
    lines.push(`${i + 1}. (${q.vote_count} vote${q.vote_count === 1 ? '' : 's'}) ${oneLine(q.body)}`)
  })
  if (open.length) lines.push('')
  lines.push(`## Answered in class (${answered.length})`)
  for (const q of answered) lines.push(`- ${oneLine(q.body)}`)
  return lines.join('\n') + '\n'
}

export function recapFileName(room: Pick<Room, 'code' | 'created_at' | 'closed_at'>): string {
  return `recap-${room.code}-${recapDate(room)}.md`
}

export function downloadRecap(room: Room, questions: Question[]) {
  const blob = new Blob([buildRecap(room, questions)], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = recapFileName(room)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
