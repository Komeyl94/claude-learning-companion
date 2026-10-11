// Pure learning logic: no `$`, so tests can call it directly.

export type Concept = {
  concept: string
  keywords: string[]
  status: 'learning' | 'mastered'
  nextReviewDate: number
  repetitions?: number
  easinessFactor?: number
  interval?: number
}

export type LearningState = {
  goal: string
  roadmap: Concept[]
  // Concept spotted during the current turn, reviewed when the turn ends.
  pendingReview: { concept: string; snippet: string } | null
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

export function findDueConcept(state: LearningState, code: string, now: number): Concept | undefined {
  const text = code.toLowerCase()
  return state.roadmap.find(item =>
    item.status !== 'mastered' &&
    (!item.nextReviewDate || now >= item.nextReviewDate) &&
    item.keywords.some(kw => matchesKeyword(text, kw)),
  )
}

// --- Roadmap parsing ---
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
    .filter((r): r is { concept: string; keywords: unknown[] } =>
      !!r && typeof r.concept === 'string' && Array.isArray(r.keywords))
    .map(r => ({
      concept: r.concept,
      keywords: r.keywords.map(k => String(k).toLowerCase()).filter(Boolean),
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
