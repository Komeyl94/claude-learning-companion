// Pure study helpers: what to study next, streaks, notes, export.
// No `$`, so tests can call them directly.
import { type Activity, type Concept, type LearningState, type Roadmap, RATINGS, isStarted, parseRoadmap } from './sm2'

// --- What to study ---
// Concepts already studied whose review is due, across every roadmap.
export function dueConcepts(state: LearningState, now: number): { goal: string; concept: Concept }[] {
  return state.roadmaps.flatMap(({ goal, roadmap }) =>
    roadmap
      .filter(c => c.status !== 'mastered' && isStarted(c) && c.nextReviewDate <= now)
      .map(concept => ({ goal, concept })))
}

// The first concept in roadmap order that was never studied.
export const nextNewConcept = (roadmap: Roadmap) => roadmap.roadmap.find(c => !isStarted(c))

// --- Rating suggestion ---
// A quiz is evidence: any wrong answer suggests "Hard", all right "Good".
export function suggestRating(quizResults: readonly boolean[]): string | undefined {
  if (!quizResults.length) return undefined
  return quizResults.every(Boolean) ? 'Good' : 'Hard'
}

// The rating labels with the suggestion first, where the dialog's cursor starts.
export function ratingOptions(suggested: string | undefined): string[] {
  const labels = Object.keys(RATINGS)
  return suggested && labels.includes(suggested) ? [suggested, ...labels.filter(l => l !== suggested)] : labels
}

// --- Streaks and daily counts ---
export function dayOf(now: number): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const previousDay = (now: number) => {
  const d = new Date(now)
  d.setDate(d.getDate() - 1)
  return dayOf(d.getTime())
}

// The activity after a rated lesson at `now`.
export function recordStudy(activity: Activity | undefined, now: number): Activity {
  const today = dayOf(now)
  if (activity?.lastDay === today) return activity
  const streak = activity?.lastDay === previousDay(now) ? activity.streak + 1 : 1
  return { ...activity, lastDay: today, streak }
}

// The streak still alive at `now`: studied today, or yesterday and not yet today.
export function currentStreak(activity: Activity | undefined, now: number): number {
  if (!activity) return 0
  return activity.lastDay === dayOf(now) || activity.lastDay === previousDay(now) ? activity.streak : 0
}

export const lessonsToday = (activity: Activity | undefined, now: number) =>
  activity?.lessonsDay === dayOf(now) ? activity.lessonsToday ?? 0 : 0

export function recordLesson(activity: Activity | undefined, now: number): Activity {
  return { lastDay: '', streak: 0, ...activity, lessonsDay: dayOf(now), lessonsToday: lessonsToday(activity, now) + 1 }
}

// --- Notes ---
export const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled'

// Where a concept's notes live under the notes folder.
export const notePath = (dir: string, goal: string, concept: string) =>
  `${dir.replace(/[\/\\]+$/, '')}/${slug(goal)}/${slug(concept)}.md`

// One lesson as a dated section; the file's heading only when it is new.
export function noteSection(
  { goal, concept, steps, now, isNew }: { goal: string; concept: string; steps: string[]; now: number; isNew: boolean },
): string {
  const head = isNew ? `# ${concept}\n\n_Roadmap: ${goal}_\n\n` : '\n'
  return `${head}## Lesson, ${dayOf(now)}\n\n${steps.join('\n\n')}\n`
}

// --- Export and import ---
// A roadmap to share: its concepts and stages, without anyone's progress.
export function toShareJson({ goal, roadmap }: Roadmap): string {
  const concepts = roadmap.map(({ concept, keywords, stage }) => ({ ...(stage ? { stage } : {}), concept, keywords }))
  return `${JSON.stringify({ goal, concepts }, null, 2)}\n`
}

export function parseShared(text: string): Roadmap | undefined {
  let raw: { goal?: unknown; concepts?: unknown }
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof raw?.goal !== 'string' || !raw.goal.trim() || !Array.isArray(raw.concepts)) return undefined
  const roadmap = parseRoadmap(JSON.stringify(raw.concepts))
  return roadmap.length ? { goal: raw.goal.trim(), roadmap } : undefined
}

// Anki's plain-text import: front, back and tags, tab-separated, one card a line.
export function toAnki({ goal, roadmap }: Roadmap, backs: Readonly<Record<string, string>>): string {
  const field = (s: string) => s.replace(/[\t\r\n]+/g, ' ').trim()
  const tag = (s: string) => slug(s).replace(/-/g, '_')
  const lines = roadmap.map(c => [
    field(c.concept),
    field(backs[c.concept] ?? `Keywords: ${c.keywords.join(', ')}`),
    [tag(goal), c.stage ? tag(c.stage) : ''].filter(Boolean).join(' '),
  ].join('\t'))
  return ['#separator:tab', '#html:false', '#tags column:3', ...lines].join('\n') + '\n'
}
