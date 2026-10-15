// Pure learning logic: no `$`, so tests can call it directly.

export type Concept = {
  concept: string
  keywords: string[]
  // Roadmap section, e.g. "Foundations"; absent on roadmaps made before stages.
  stage?: string
  status: 'learning' | 'mastered'
  nextReviewDate: number
  repetitions?: number
  easinessFactor?: number
  interval?: number
}

export type Roadmap = {
  goal: string
  roadmap: Concept[]
  // What the learner said about themselves in `/companion-roadmap update`,
  // so later updates and every lesson are pitched at their level.
  background?: string
}

export type Activity = {
  // Local calendar day of the last rated lesson, as YYYY-MM-DD.
  lastDay: string
  // Consecutive days with at least one rated lesson, ending at lastDay.
  streak: number
  // Lessons started on `lessonsDay`, counted against the daily cap.
  lessonsDay?: string
  lessonsToday?: number
}

export type LearningState = {
  roadmaps: Roadmap[]
  activity?: Activity
  // Concept spotted during the current turn, reviewed when the turn ends.
  pendingReview: { goal: string; concept: string; snippet: string } | null
}

// Reads the store's value, upgrading the single-roadmap shape of 2.0
// ({ goal, roadmap, pendingReview }) to a list of roadmaps.
export function migrateState(raw: unknown): LearningState | undefined {
  const value = raw as Record<string, unknown> | undefined
  if (!value) return undefined
  if (Array.isArray(value.roadmaps)) return value as unknown as LearningState
  if (typeof value.goal === 'string' && Array.isArray(value.roadmap)) {
    return { roadmaps: [{ goal: value.goal, roadmap: value.roadmap as Concept[] }], pendingReview: null }
  }
  return undefined
}

const DAY_MS = 24 * 60 * 60 * 1000

// --- SM-2 Algorithm Implementation ---
export function calculateSM2(quality: number, item: Concept, now: number) {
  let { repetitions = 0, easinessFactor = 2.5, interval = 0 } = item
  if (quality >= 3) {
    if (repetitions === 0) interval = 1
    else if (repetitions === 1) interval = 6
    else interval = Math.round(interval * easinessFactor)
    repetitions += 1
  } else {
    repetitions = 0
    interval = 1
  }
  easinessFactor = Math.max(1.3, easinessFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)))
  return { repetitions, easinessFactor, interval, nextReviewDate: now + interval * DAY_MS }
}

export function applyRating(item: Concept, quality: number, now: number): Concept {
  const next = { ...item, ...calculateSM2(quality, item, now) }
  if (quality >= 4 && next.interval > 30) next.status = 'mastered'
  return next
}

// --- Keyword matching ---
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Whole-word match, so "get" does not fire on "target". A boundary is only
// required on a side where the keyword starts or ends with a word character,
// so "route::" still matches "Route::get(" and "table->" matches "$table->id()".
export function matchesKeyword(text: string, kw: string) {
  const k = kw.toLowerCase()
  const before = /^\w/.test(k) ? '(?<!\\w)' : ''
  const after = /\w$/.test(k) ? '(?!\\w)' : ''
  return new RegExp(`${before}${escapeRegex(k)}${after}`).test(text)
}

// The first due, unmastered concept the code uses, across every roadmap.
export function findDueConcept(state: LearningState, code: string, now: number): { goal: string; concept: Concept } | undefined {
  const text = code.toLowerCase()
  for (const { goal, roadmap } of state.roadmaps) {
    const concept = roadmap.find(item =>
      item.status !== 'mastered' &&
      (!item.nextReviewDate || now >= item.nextReviewDate) &&
      item.keywords.some(kw => matchesKeyword(text, kw)),
    )
    if (concept) return { goal, concept }
  }
  return undefined
}

// --- Roadmap management ---
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// A roadmap by its number in the list (1-based), its goal, or a unique part
// of its goal; else a message saying why none was picked.
export function findRoadmap(state: LearningState | undefined, selector: string): Roadmap | string {
  const roadmaps = state?.roadmaps ?? []
  const sel = selector.trim()
  if (!roadmaps.length) return 'No roadmaps yet. Start one with `/companion-roadmap <goal>`.'
  if (!sel) return 'Name a roadmap by its number or goal: see `/companion-roadmap`.'
  if (/^\d+$/.test(sel)) {
    const found = roadmaps[Number(sel) - 1]
    return found ?? `No roadmap #${sel}: see \`/companion-roadmap\`.`
  }
  const exact = roadmaps.find(r => sameName(r.goal, sel))
  if (exact) return exact
  const partial = roadmaps.filter(r => r.goal.toLowerCase().includes(sel.toLowerCase()))
  const [only] = partial
  if (only && partial.length === 1) return only
  return partial.length
    ? `"${sel}" matches ${partial.length} roadmaps; use its number: see \`/companion-roadmap\`.`
    : `No roadmap matches "${sel}": see \`/companion-roadmap\`.`
}

// A roadmap followed by notes about the learner, as `update` takes them:
// "1 I know React well" or "docker skip the basics". A leading number is the
// roadmap; otherwise the longest run of leading words that names one.
export function findRoadmapWithNotes(state: LearningState | undefined, args: string): { roadmap: Roadmap; notes: string } | string {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const counts = /^\d+$/.test(words[0] ?? '') ? [1] : words.map((_, i) => words.length - i)
  for (const n of counts) {
    const found = findRoadmap(state, words.slice(0, n).join(' '))
    if (typeof found !== 'string') return { roadmap: found, notes: words.slice(n).join(' ') }
  }
  const missing = findRoadmap(state, counts.length === 1 ? words[0]! : args)
  return typeof missing === 'string' ? missing : { roadmap: missing, notes: '' }
}

export const findRoadmapByGoal = (state: LearningState | undefined, goal: string) =>
  state?.roadmaps.find(r => sameName(r.goal, goal))

// A regenerated roadmap with the learner's progress kept: a concept of the
// same name keeps its schedule, and a concept already studied is never
// dropped, even when the new roadmap leaves it out.
export function mergeRoadmap(old: Concept[], fresh: Concept[]): Concept[] {
  const merged = fresh.map(c => {
    const before = old.find(o => sameName(o.concept, c.concept))
    return before ? { ...before, concept: c.concept, keywords: c.keywords, stage: c.stage ?? before.stage } : c
  })
  const kept = old.filter(o => isStarted(o) && !merged.some(c => sameName(c.concept, o.concept)))
  return [...merged, ...kept]
}

// --- Roadmap parsing ---
// Words in nearly every program, and file names or paths, say nothing about a
// concept: "config/" or "get" would fire on any code at all.
const GENERIC_KEYWORDS = new Set([
  'get', 'set', 'new', 'id', 'name', 'data', 'value', 'item', 'list', 'type', 'test', 'run', 'use', 'app',
  'function', 'return', 'class', 'import', 'export', 'const', 'let', 'var', 'if', 'else', 'for', 'while',
  'public', 'private', 'static', 'async', 'await', 'string', 'int', 'true', 'false', 'null', 'config',
])

export function isUsefulKeyword(k: string): boolean {
  if (k.length < 3 || GENERIC_KEYWORDS.has(k)) return false
  // A path or a file name: "config/", "app/models", ".env", "composer.json"
  if (/[/\\]/.test(k) || /^\.(env|git\w*|npmrc|htaccess|editorconfig|babelrc|eslintrc|prettierrc)\b/.test(k) || /\.(json|ya?ml|toml|lock|xml|ini|md|txt)$/.test(k)) return false
  return true
}


export function parseRoadmap(text: string): Concept[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is { concept: string; keywords: unknown[]; stage?: unknown } =>
      !!r && typeof r.concept === 'string' && Array.isArray(r.keywords))
    .map(r => ({
      concept: r.concept,
      keywords: r.keywords.map(k => String(k).trim().toLowerCase()).filter(isUsefulKeyword),
      ...(typeof r.stage === 'string' && r.stage.trim() ? { stage: r.stage.trim() } : {}),
      status: 'learning' as const,
      nextReviewDate: 0,
    }))
    .filter(c => c.keywords.length > 0)
}

// Anki-style answers: AskUserQuestion takes 2-4 options, so the 0-5 SM-2 scale
// is offered as four labels. A digit typed under "Other" is taken as-is.
export const RATINGS: Record<string, number> = {
  'Forgot it': 1,
  'Hard': 3,
  'Good': 4,
  'Easy': 5,
}

export function parseRating(answer: string): number | undefined {
  if (answer in RATINGS) return RATINGS[answer]
  const n = Number.parseInt(answer.trim(), 10)
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : undefined
}

// --- Secret handling ---
// Files whose contents are never inspected or stored.
const SECRET_PATH = /(^|[\/\\])(\.env(\..*)?|\.npmrc|\.netrc|\.pgpass|credentials(\.\w+)?|secrets?\.\w+|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?)$|\.(pem|key|p12|pfx|keystore|jks)$/i

export const isSecretPath = (path: string) => SECRET_PATH.test(path)

const SECRET_PATTERNS: [RegExp, string][] = [
  // PEM private key blocks
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]'],
  // Credentials inside URLs: scheme://user:pass@host
  [/(\w+:\/\/)[^\s\/:@]+:[^\s\/@]+@/g, '$1[REDACTED]@'],
  // Authorization headers
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+\/=-]{8,}/gi, '$1 [REDACTED]'],
  // NAME=value / name: value where the name looks secret
  [/\b([\w.-]*(?:key|secret|token|passw(?:or)?d|pwd|auth|credential)[\w.-]*["']?\s*(?:=>|=(?!>)|:(?!:))\s*)(["']?)(?!\[REDACTED|(?:bearer|basic)\s)([^\s"',;()\[\]{}]+)\2/gi, '$1$2[REDACTED]$2'],
  // Well-known token formats
  [/\b(sk-ant-[\w-]{10,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|glpat-[\w-]{20,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{35}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,})\b/g, '[REDACTED]'],
]

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((t, [pattern, replacement]) => t.replace(pattern, replacement), text)
}

// --- Quiz parsing ---
export type Quiz = { question: string; options: string[]; answer: number; why: string }

// A multiple-choice question as the model writes it: {question, options[4], answer (0-3), why}.
export function parseQuiz(text: string): Quiz | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  const { question, options, answer, why } = raw ?? {}
  if (typeof question !== 'string' || !Array.isArray(options)) return undefined
  const labels = options.map(o => String(o).trim()).filter(Boolean)
  // The dialog takes 2-4 distinct labels.
  if (labels.length < 2 || labels.length > 4 || new Set(labels).size !== labels.length) return undefined
  if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer >= labels.length) return undefined
  return { question, options: labels, answer, why: typeof why === 'string' ? why : '' }
}

// --- Progress ---
export const isStarted = (c: Concept) => c.status === 'mastered' || c.nextReviewDate > 0

function progressBar(done: number, total: number, width = 20) {
  const filled = total ? Math.round((done / total) * width) : 0
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function conceptLine(c: Concept, now: number) {
  if (c.status === 'mastered') return `  ✅ ${c.concept}: mastered`
  if (!isStarted(c)) return `  ⬜ ${c.concept}: not started`
  if (c.nextReviewDate <= now) return `  🔁 ${c.concept}: due for review`
  return `  📅 ${c.concept}: next review ${new Date(c.nextReviewDate).toLocaleDateString()}`
}

const counts = (roadmap: Concept[], now: number) => {
  const mastered = roadmap.filter(c => c.status === 'mastered').length
  const started = roadmap.filter(isStarted).length
  const due = roadmap.filter(c => c.status !== 'mastered' && isStarted(c) && c.nextReviewDate <= now).length
  return { mastered, learning: started - mastered, notStarted: roadmap.length - started, due, total: roadmap.length }
}

export const NO_ROADMAP = 'No roadmap yet. Start one with `/companion-roadmap <goal>`, e.g. `/companion-roadmap Node.js backend`.'

// One roadmap in full: totals, then every concept by stage.
export function describeProgress({ goal, roadmap }: Roadmap, now: number): string {
  const n = counts(roadmap, now)

  // Stages in roadmap order; concepts without one fall under "Concepts".
  const stages = new Map<string, Concept[]>()
  for (const c of roadmap) {
    const stage = c.stage ?? 'Concepts'
    stages.set(stage, [...(stages.get(stage) ?? []), c])
  }

  const lines = [
    `🎯 Goal: ${goal}`,
    `${progressBar(n.mastered, n.total)} ${n.mastered}/${n.total} mastered`,
    `${n.learning} learning · ${n.notStarted} not started · ${n.due} due for review`,
  ]
  let i = 0
  for (const [stage, concepts] of stages) {
    i += 1
    const done = concepts.filter(c => c.status === 'mastered').length
    lines.push('', `Stage ${i} · ${stage} (${done}/${concepts.length})`, ...concepts.map(c => conceptLine(c, now)))
  }
  return lines.join('\n')
}

// Every roadmap, one line each, and the commands that manage them.
export function describeRoadmaps(state: LearningState | undefined, now: number): string {
  if (!state?.roadmaps.length) return NO_ROADMAP
  return [
    '📚 Your roadmaps',
    ...state.roadmaps.map(({ goal, roadmap }, i) => {
      const n = counts(roadmap, now)
      return `  ${i + 1}. ${goal}: ${progressBar(n.mastered, n.total, 10)} ${n.mastered}/${n.total} mastered · ${n.due} due`
    }),
    '',
    ROADMAP_HELP,
  ].join('\n')
}

export const ROADMAP_HELP = [
  '`/companion-progress <#>` details one · `/companion-roadmap <goal>` adds one (or updates it, keeping progress)',
  '`/companion-roadmap update <#> [about you]` regenerates one, keeping progress · `/companion-roadmap remove <#>` deletes one',
].join('\n')
