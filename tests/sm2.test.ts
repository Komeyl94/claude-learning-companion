import { describe, expect, test } from 'claude-code/testing'
import { applyRating, findDueConcept, matchesKeyword, parseRating, parseRoadmap, type LearningState } from '../hooks/sm2'

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
