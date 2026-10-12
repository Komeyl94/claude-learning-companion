import { describe, expect, test } from 'claude-code/testing'
import { type Concept, type LearningState, isUsefulKeyword } from '../hooks/sm2'
import {
  currentStreak, dayOf, dueConcepts, lessonsToday, nextNewConcept, noteSection, notePath, parseShared,
  ratingOptions, recordLesson, recordStudy, slug, suggestRating, toAnki, toShareJson,
} from '../hooks/study'

const DAY = 24 * 60 * 60 * 1000
// Noon local time, so adding or removing a day never crosses midnight twice.
const NOON = new Date(2026, 9, 12, 12).getTime()

const concept = (name: string, extra: Partial<Concept> = {}): Concept =>
  ({ concept: name, keywords: ['x'], status: 'learning', nextReviewDate: 0, ...extra })

describe('what to study', () => {
  const state: LearningState = {
    pendingReview: null,
    roadmaps: [
      {
        goal: 'Laravel',
        roadmap: [
          concept('Routing', { nextReviewDate: NOON - DAY }),
          concept('ORM', { nextReviewDate: NOON + DAY }),
          concept('Queues'),
          concept('Done', { status: 'mastered', nextReviewDate: NOON - DAY }),
        ],
      },
      { goal: 'Docker', roadmap: [concept('Images', { nextReviewDate: NOON })] },
    ],
  }

  test('due means studied, not mastered, and at or past its date', () => {
    expect(dueConcepts(state, NOON).map(d => `${d.goal}/${d.concept.concept}`)).toEqual(['Laravel/Routing', 'Docker/Images'])
  })

  test('the next new concept is the first never studied, in order', () => {
    expect(nextNewConcept(state.roadmaps[0]!)?.concept).toBe('Queues')
    expect(nextNewConcept(state.roadmaps[1]!)).toBeUndefined()
  })
})

describe('rating suggestion', () => {
  test('quiz answers suggest a rating, which is offered first', () => {
    expect(suggestRating([])).toBeUndefined()
    expect(suggestRating([true, true])).toBe('Good')
    expect(suggestRating([true, false])).toBe('Hard')
    expect(ratingOptions('Hard')).toEqual(['Hard', 'Forgot it', 'Good', 'Easy'])
    expect(ratingOptions(undefined)).toEqual(['Forgot it', 'Hard', 'Good', 'Easy'])
  })
})

describe('streaks', () => {
  test('a day in a row grows the streak, a gap restarts it, the same day keeps it', () => {
    const first = recordStudy(undefined, NOON)
    expect(first).toEqual({ lastDay: dayOf(NOON), streak: 1 })
    const second = recordStudy(first, NOON + DAY)
    expect(second.streak).toBe(2)
    expect(recordStudy(second, NOON + DAY + 1000).streak).toBe(2)
    expect(recordStudy(second, NOON + 3 * DAY).streak).toBe(1)
  })

  test('a streak lasts until a whole day is missed', () => {
    const activity = { lastDay: dayOf(NOON), streak: 4 }
    expect(currentStreak(activity, NOON)).toBe(4)
    expect(currentStreak(activity, NOON + DAY)).toBe(4)
    expect(currentStreak(activity, NOON + 2 * DAY)).toBe(0)
  })

  test('lessons are counted per day', () => {
    const one = recordLesson(undefined, NOON)
    const two = recordLesson(one, NOON + 1000)
    expect(lessonsToday(two, NOON)).toBe(2)
    expect(lessonsToday(two, NOON + DAY)).toBe(0)
    expect(recordLesson(two, NOON + DAY).lessonsToday).toBe(1)
  })
})

describe('notes', () => {
  test('one file per concept under a folder per roadmap', () => {
    expect(slug('Laravel backend!')).toBe('laravel-backend')
    expect(notePath('/home/u/notes/', 'Laravel backend', 'Eloquent: Relationships')).toBe('/home/u/notes/laravel-backend/eloquent-relationships.md')
  })

  test('a new file gets a heading, later lessons only a dated section', () => {
    const first = noteSection({ goal: 'Laravel', concept: 'Routing', steps: ['A', 'B'], now: NOON, isNew: true })
    expect(first).toBe(`# Routing\n\n_Roadmap: Laravel_\n\n## Lesson, ${dayOf(NOON)}\n\nA\n\nB\n`)
    expect(noteSection({ goal: 'Laravel', concept: 'Routing', steps: ['C'], now: NOON, isNew: false }))
      .toBe(`\n## Lesson, ${dayOf(NOON)}\n\nC\n`)
  })
})

describe('export', () => {
  const roadmap = {
    goal: 'Laravel',
    roadmap: [concept('Routing', { stage: 'Basics', keywords: ['route::'], repetitions: 3, nextReviewDate: NOON })],
  }

  test('a shared roadmap leaves progress out and reads back', () => {
    const json = toShareJson(roadmap)
    expect(json).not.toContain('repetitions')
    expect(parseShared(json)).toEqual({
      goal: 'Laravel',
      roadmap: [{ concept: 'Routing', keywords: ['route::'], stage: 'Basics', status: 'learning', nextReviewDate: 0 }],
    })
    expect(parseShared('{"goal":"x"}')).toBeUndefined()
    expect(parseShared('not json')).toBeUndefined()
  })

  test('Anki cards are tab-separated with tags, falling back to keywords', () => {
    const lines = toAnki(roadmap, { Routing: 'Maps\tURLs to\ncode.' }).trim().split('\n')
    expect(lines.slice(0, 3)).toEqual(['#separator:tab', '#html:false', '#tags column:3'])
    expect(lines[3]).toBe('Routing\tMaps URLs to code.\tlaravel basics')
    expect(toAnki(roadmap, {})).toContain('Routing\tKeywords: route::\t')
  })
})

describe('keywords', () => {
  test('generic words, paths and file names are dropped', () => {
    for (const k of ['get', 'config', 'id', 'config/', 'app/models', '.env', '.gitignore', 'composer.json'])
      expect(isUsefulKeyword(k)).toBe(false)
    for (const k of ['route::', 'hasmany', '$table->', '.then', 'express.router', 'useeffect'])
      expect(isUsefulKeyword(k)).toBe(true)
  })
})
