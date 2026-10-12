import { describe, expect, test } from 'claude-code/testing'
import {
  type Concept, type LearningState, applyRating, describeProgress, describeRoadmaps, findDueConcept, findRoadmap,
  isSecretPath, matchesKeyword, mergeRoadmap, migrateState, parseQuiz, parseRating, parseRoadmap, redactSecrets,
} from '../hooks/sm2'

const DAY = 24 * 60 * 60 * 1000

describe('SM-2', () => {
  const fresh = { concept: 'Routing', keywords: ['app.get'], status: 'learning' as const, nextReviewDate: 0 }

  test('good answers grow the interval 1, 6, then by easiness', () => {
    const a = applyRating(fresh, 4, 0)
    const b = applyRating(a, 4, 0)
    const c = applyRating(b, 4, 0)
    expect([a.interval, b.interval, c.interval]).toEqual([1, 6, 15])
    expect(a.nextReviewDate).toBe(DAY)
  })

  test('a failed answer resets repetitions', () => {
    const b = applyRating(applyRating(fresh, 5, 0), 1, 0)
    expect(b.repetitions).toBe(0)
    expect(b.interval).toBe(1)
  })
})

describe('matching', () => {
  test('keywords match whole words only', () => {
    expect(matchesKeyword('app.get("/")', 'app.get')).toBe(true)
    expect(matchesKeyword('const target = 1', 'get')).toBe(false)
  })

  test('keywords ending in punctuation match what follows them', () => {
    expect(matchesKeyword("route::get('/users', fn)", 'route::')).toBe(true)
    expect(matchesKeyword('$table->id();', 'table->')).toBe(true)
    expect(matchesKeyword('$validated = $request->validate()', '$validated')).toBe(true)
    expect(matchesKeyword('reroute::x', 'route::')).toBe(false)
  })

  test('only due, unmastered concepts are found, across roadmaps', () => {
    const state: LearningState = {
      pendingReview: null,
      roadmaps: [
        {
          goal: 'Node',
          roadmap: [
            { concept: 'Later', keywords: ['express'], status: 'learning', nextReviewDate: 10 * DAY },
            { concept: 'Done', keywords: ['express'], status: 'mastered', nextReviewDate: 0 },
          ],
        },
        { goal: 'Web', roadmap: [{ concept: 'Now', keywords: ['express'], status: 'learning', nextReviewDate: 0 }] },
      ],
    }
    const due = findDueConcept(state, 'require("express")', DAY)
    expect(due?.goal).toBe('Web')
    expect(due?.concept.concept).toBe('Now')
  })
})

describe('parsing', () => {
  test('roadmap JSON is found inside surrounding text and fences', () => {
    const roadmap = parseRoadmap('Sure!\n```json\n[{"concept":"Streams","keywords":["Pipe","readable"]}]\n```')
    expect(roadmap).toEqual([{ concept: 'Streams', keywords: ['pipe', 'readable'], status: 'learning', nextReviewDate: 0 }])
    expect(parseRoadmap('no json here')).toEqual([])
  })

  test('roadmap stages are kept when given', () => {
    expect(parseRoadmap('[{"stage":" Data ","concept":"ORM","keywords":["prisma"]}]')[0]?.stage).toBe('Data')
  })

  test('quizzes need 2-4 distinct options and a valid answer', () => {
    const q = parseQuiz('```json\n{"question":"Q?","options":["a","b","c","d"],"answer":2,"why":"w"}\n```')
    expect(q).toEqual({ question: 'Q?', options: ['a', 'b', 'c', 'd'], answer: 2, why: 'w' })
    expect(parseQuiz('{"question":"Q?","options":["a","b"],"answer":2}')).toBeUndefined()
    expect(parseQuiz('{"question":"Q?","options":["a","a"],"answer":0}')).toBeUndefined()
    expect(parseQuiz('{"question":"Q?","options":["a","b","c","d","e"],"answer":0}')).toBeUndefined()
  })

  test('ratings accept labels and digits typed under Other', () => {
    expect(parseRating('Good')).toBe(4)
    expect(parseRating(' 2 ')).toBe(2)
    expect(parseRating('7')).toBeUndefined()
  })
})

const concept = (name: string, extra: Partial<Concept> = {}): Concept =>
  ({ concept: name, keywords: ['x'], status: 'learning', nextReviewDate: 0, ...extra })

describe('progress', () => {
  test('groups concepts by stage and counts each state', () => {
    const text = describeProgress({
      goal: 'Backend',
      roadmap: [
        concept('HTTP', { stage: 'Foundations', status: 'mastered', nextReviewDate: DAY }),
        concept('Routing', { stage: 'Foundations', nextReviewDate: DAY }),
        concept('ORM', { stage: 'Data', nextReviewDate: 10 * DAY }),
        concept('Caching', { stage: 'Data' }),
      ],
    }, 2 * DAY)
    expect(text).toContain('1/4 mastered')
    expect(text).toContain('2 learning · 1 not started · 1 due for review')
    expect(text).toContain('Stage 1 · Foundations (1/2)')
    expect(text).toContain('Stage 2 · Data (0/2)')
    expect(text).toContain('🔁 Routing: due for review')
    expect(text).toContain('⬜ Caching: not started')
  })

  test('lists every roadmap on one line each', () => {
    const state: LearningState = {
      pendingReview: null,
      roadmaps: [
        { goal: 'Laravel', roadmap: [concept('Routing', { status: 'mastered', nextReviewDate: DAY }), concept('ORM')] },
        { goal: 'Docker', roadmap: [concept('Images')] },
      ],
    }
    const text = describeRoadmaps(state, 0)
    expect(text).toContain('1. Laravel: █████░░░░░ 1/2 mastered')
    expect(text).toContain('2. Docker:')
  })
})

describe('roadmaps', () => {
  const state: LearningState = {
    pendingReview: null,
    roadmaps: [
      { goal: 'Laravel backend', roadmap: [] },
      { goal: 'Docker', roadmap: [] },
      { goal: 'Docker Swarm', roadmap: [] },
    ],
  }

  test('a 2.0 single roadmap is upgraded to a list', () => {
    const old = { goal: 'g', roadmap: [concept('A')], pendingReview: { concept: 'A', snippet: 's' } }
    expect(migrateState(old)).toEqual({ roadmaps: [{ goal: 'g', roadmap: [concept('A')] }], pendingReview: null })
    expect(migrateState(state)).toBe(state)
    expect(migrateState(undefined)).toBeUndefined()
  })

  test('found by number, goal, or a unique part of the goal', () => {
    expect(findRoadmap(state, '2')).toBe(state.roadmaps[1])
    expect(findRoadmap(state, 'docker')).toBe(state.roadmaps[1])
    expect(findRoadmap(state, 'laravel')).toBe(state.roadmaps[0])
    expect(findRoadmap(state, 'dock')).toContain('matches 2 roadmaps')
    expect(findRoadmap(state, '9')).toContain('No roadmap #9')
    expect(findRoadmap(state, 'rust')).toContain('No roadmap matches')
  })

  test('a merge keeps progress and never drops a studied concept', () => {
    const studied = concept('Routing', { stage: 'Basics', repetitions: 2, interval: 6, nextReviewDate: 6 * DAY })
    const old = [studied, concept('Unseen'), concept('Dropped but studied', { nextReviewDate: DAY })]
    const fresh = [concept('routing', { keywords: ['route::'], stage: 'Foundations' }), concept('Queues')]
    expect(mergeRoadmap(old, fresh)).toEqual([
      { ...studied, concept: 'routing', keywords: ['route::'], stage: 'Foundations' },
      concept('Queues'),
      concept('Dropped but studied', { nextReviewDate: DAY }),
    ])
  })
})

describe('secrets', () => {
  test('secret files are recognised', () => {
    for (const p of ['.env', 'app/.env.production', 'C:\\proj\\.env', 'certs/server.key', '/home/u/.ssh/id_ed25519', 'config/secrets.yml', '.npmrc'])
      expect(isSecretPath(p)).toBe(true)
    for (const p of ['routes/web.php', 'env.ts', 'app/Http/Middleware/Authenticate.php', 'keyboard.ts'])
      expect(isSecretPath(p)).toBe(false)
  })

  test('secret values are redacted, code is kept', () => {
    const cases: [string, string][] = [
      ['export ANTHROPIC_API_KEY=sk-ant-abc123def456ghi', 'export ANTHROPIC_API_KEY=[REDACTED]'],
      ["DB_PASSWORD='hunter2'", "DB_PASSWORD='[REDACTED]'"],
      ["'token' => 'abcdef123456'", "'token' => '[REDACTED]'"],
      ['curl -H "Authorization: Bearer abcdefghijkl"', 'curl -H "Authorization: Bearer [REDACTED]"'],
      ['git clone https://user:pa55@github.com/x/y', 'git clone https://[REDACTED]@github.com/x/y'],
      ['push with ghp_aaaaaaaaaaaaaaaaaaaaaaaa', 'push with [REDACTED]'],
      ['-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----', '[REDACTED PRIVATE KEY]'],
    ]
    for (const [input, expected] of cases) expect(redactSecrets(input)).toBe(expected)
    expect(redactSecrets("Route::middleware('auth')->group(fn () => ['auth' => ['web']])"))
      .toBe("Route::middleware('auth')->group(fn () => ['auth' => ['web']])")
    expect(redactSecrets("Route::get('/users', [UserController::class, 'index']);"))
      .toBe("Route::get('/users', [UserController::class, 'index']);")
  })
})
