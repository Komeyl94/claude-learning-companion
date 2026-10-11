import { describe, expect, test } from 'claude-code/testing'
import { applyRating, findDueConcept, isSecretPath, matchesKeyword, parseRating, parseRoadmap, redactSecrets, type LearningState } from '../hooks/sm2'

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

  test('only due, unmastered concepts are found', () => {
    const state: LearningState = {
      goal: 'g',
      pendingReview: null,
      roadmap: [
        { concept: 'Later', keywords: ['express'], status: 'learning', nextReviewDate: 10 * DAY },
        { concept: 'Done', keywords: ['express'], status: 'mastered', nextReviewDate: 0 },
        { concept: 'Now', keywords: ['express'], status: 'learning', nextReviewDate: 0 },
      ],
    }
    expect(findDueConcept(state, 'require("express")', DAY)?.concept).toBe('Now')
  })
})

describe('parsing', () => {
  test('roadmap JSON is found inside surrounding text and fences', () => {
    const roadmap = parseRoadmap('Sure!\n```json\n[{"concept":"Streams","keywords":["Pipe","readable"]}]\n```')
    expect(roadmap).toEqual([{ concept: 'Streams', keywords: ['pipe', 'readable'], status: 'learning', nextReviewDate: 0 }])
    expect(parseRoadmap('no json here')).toEqual([])
  })

  test('ratings accept labels and digits typed under Other', () => {
    expect(parseRating('Good')).toBe(4)
    expect(parseRating(' 2 ')).toBe(2)
    expect(parseRating('7')).toBeUndefined()
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
