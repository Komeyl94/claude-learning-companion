import type { CommandRunInput, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// The engine stamps `origin` and `presentation` on a real run.
const run = (command: string, args = '') => ({ command, args }) as unknown as CommandRunInput

const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const QUIZ = '{"question":"What does Route::get do?","options":["Maps a GET URL","Sends mail","Runs SQL","Logs in"],"answer":0,"why":"It registers a GET route."}'

// Lesson text for every completion; a quiz when one is asked for. Records prompts.
function model(on: On, prompts: string[] = []) {
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)
    const text = e.prompt.includes('multiple-choice') ? QUIZ : 'Routes map URLs to code.'
    return { value: { isAnswered: true as const, text, usage } }
  })
  return prompts
}

// Answers each dialog by its header from a script, in order; records what was asked.
type Asked = { header: string; question: string; options: string[] }
function learner(on: On, script: Record<string, string[]>, asked: Asked[] = []) {
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const [q] = e.questions
    asked.push({ header: q!.header, question: q!.question, options: q!.options.map(o => o.label) })
    const label = script[q!.header]?.shift()
    if (label === undefined) return { deny: 'dismissed' }
    return { result: { questions: e.questions, answers: { [q!.question]: label } } }
  })
  return asked
}

// Files in memory, under a fake home. The engine makes paths absolute, so a
// file in the working directory is kept under its name alone.
function files(on: On, initial: Record<string, string> = {}) {
  const fs = new Map(Object.entries(initial))
  const key = (path: string) => (path.startsWith('/home/learner/') ? path : path.split(/[\/\\]/).pop()!)
  mock.env(on, { HOME: '/home/learner' })
  on('fs.read', (_$, e) => {
    const text = fs.get(key(e.path))
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_$, e) => {
    fs.set(key(e.path), e.text)
    return { value: undefined }
  })
  return fs
}

const fresh = (name: string, extra = {}) => ({ concept: name, keywords: ['route::'], status: 'learning', nextReviewDate: 0, ...extra })
const store = (roadmap: object[], goal = 'Laravel') => ({ state: { roadmaps: [{ goal, roadmap }], pendingReview: null } })

test('/learn teaches the next new concept, quizzes, suggests a rating and saves notes', async ($, on) => {
  mock.store(on, store([fresh('Routing', { nextReviewDate: 1, repetitions: 1, interval: 1 }), fresh('Middleware')]))
  model(on)
  const fs = files(on)
  const asked = learner(on, { Lesson: ['Quiz me', 'Rate it'], Quiz: ['Maps a GET URL'], Review: ['Good'] })

  const out = await $.command.run(run('learn'))
  expect(out.text).toContain('Learned "Middleware"')

  const review = asked.find(a => a.header === 'Review')!
  expect(review.question).toContain('Your quiz suggests: Good')
  expect(review.options[0]).toBe('Good')

  const note = fs.get('/home/learner/learning-notes/laravel/middleware.md')
  expect(note).toContain('# Middleware')
  expect(note).toContain('Routes map URLs to code.')
  expect(note).toContain('✅ Correct')

  const progress = await $.command.run(run('progress'))
  expect(progress.text).toContain('📅 Middleware: next review')
})

test('a wrong quiz answer suggests Hard', async ($, on) => {
  mock.store(on, store([fresh('Routing')]))
  model(on)
  files(on)
  const asked = learner(on, { Lesson: ['Quiz me', 'Rate it'], Quiz: ['Sends mail'], Review: ['Hard'] })

  await $.command.run(run('learn'))
  expect(asked.find(a => a.header === 'Review')!.options[0]).toBe('Hard')
})

test('/learn stops when the lesson is closed, leaving the concept new', async ($, on) => {
  mock.store(on, store([fresh('Routing')]))
  model(on)
  files(on)
  learner(on, {})

  const out = await $.command.run(run('learn'))
  expect(out.text).toContain('Stopped "Routing"')
  const progress = await $.command.run(run('progress'))
  expect(progress.text).toContain('⬜ Routing: not started')
})

test('/practice goes through every due concept', async ($, on) => {
  mock.store(on, store([
    fresh('Routing', { nextReviewDate: 1, repetitions: 1, interval: 1 }),
    fresh('Middleware', { nextReviewDate: 1, repetitions: 1, interval: 1 }),
    fresh('Queues'),
  ]))
  model(on)
  files(on)
  const asked = learner(on, { Lesson: ['Rate it', 'Rate it'], Review: ['Good', 'Easy'] })

  const out = await $.command.run(run('practice'))
  expect(out.text).toContain('Reviewed 2 of 2')
  expect(asked.filter(a => a.header === 'Review').map(a => a.question)).toEqual([
    'How well do you understand "Routing" now?',
    'How well do you understand "Middleware" now?',
  ])

  const again = await $.command.run(run('practice'))
  expect(again.text).toContain('Nothing due')
})

test('notes are off when the notes folder is empty', { options: { notesDir: '' } }, async ($, on) => {
  mock.store(on, store([fresh('Routing')]))
  model(on)
  const fs = files(on)
  learner(on, { Lesson: ['Rate it'], Review: ['Good'] })

  await $.command.run(run('learn'))
  expect([...fs.keys()]).toEqual([])
})

test('the lesson model comes from settings', { options: { lessonModel: 'sonnet' } }, async ($, on) => {
  mock.store(on, store([fresh('Routing')]))
  const models: string[] = []
  on('model.complete', (_$, e) => {
    models.push(e.model)
    return { value: { isAnswered: true as const, text: 'x', usage } }
  })
  files(on)
  learner(on, { Lesson: ['Rate it'], Review: ['Good'] })

  await $.command.run(run('learn'))
  expect(models.length).toBeGreaterThan(0)
  expect(models.every(m => m === 'sonnet')).toBe(true)
})

test('/roadmap reads the project manifest for keywords', async ($, on) => {
  mock.store(on)
  files(on, { 'composer.json': '{"require":{"laravel/framework":"^11.0"}}' })
  const prompts: string[] = []
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true as const, text: '[{"concept":"Routing","keywords":["route::","config/"]}]', usage } }
  })

  const out = await $.command.run(run('roadmap', 'Laravel'))
  expect(prompts[0]).toContain('laravel/framework')
  // "config/" is a path, so it is dropped.
  expect(out.text).toContain('1 concepts')
})

test('/roadmap export and import round-trip a roadmap without progress', async ($, on) => {
  mock.store(on, store([fresh('Routing', { stage: 'Basics', nextReviewDate: 5, repetitions: 2 })], 'Laravel backend'))
  model(on)
  const fs = files(on)
  learner(on, { Remove: ['Remove it'] })

  const exported = await $.command.run(run('roadmap', 'export 1'))
  expect(exported.text).toContain('laravel-backend.roadmap.json')
  expect(fs.get('laravel-backend.roadmap.json')).not.toContain('repetitions')

  await $.command.run(run('roadmap', 'remove 1'))
  const imported = await $.command.run(run('roadmap', 'import laravel-backend.roadmap.json'))
  expect(imported.text).toContain('Roadmap for "Laravel backend"')
  expect(imported.text).toContain('⬜ Routing: not started')
})

test('/roadmap export anki writes cards with model-written backs', async ($, on) => {
  mock.store(on, store([fresh('Routing')]))
  on('model.complete', () => ({ value: { isAnswered: true as const, text: '{"Routing":"Maps URLs to code."}', usage } }))
  const fs = files(on)

  const out = await $.command.run(run('roadmap', 'export laravel anki'))
  expect(out.text).toContain('1 Anki cards')
  expect(fs.get('laravel.anki.txt')).toContain('Routing\tMaps URLs to code.\tlaravel')
})
