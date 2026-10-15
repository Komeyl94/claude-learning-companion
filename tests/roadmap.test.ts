import type { CommandRunInput, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// The engine stamps `origin` and `presentation` on a real run.
const run = (command: string, args = '') => ({ command, args }) as unknown as CommandRunInput
const roadmap = (args = '') => run('roadmap', args)

const ROADMAP = '[{"stage":"Foundations","concept":"Routing","keywords":["app.get"]}]'
const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const answer = (text: string) => ({ value: { isAnswered: true as const, text, usage } })

// What the learner picks in a `$.ui.ask` dialog.
const choose = (on: On, label: string) =>
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => ({
    result: { questions: e.questions, answers: Object.fromEntries(e.questions.map(q => [q.question, label])) },
  }))

test('/roadmap <goal> builds a roadmap, /roadmap lists it, /progress details it', async ($, on) => {
  mock.store(on)
  on('model.complete', () => answer(ROADMAP))

  const built = await $.command.run(roadmap('Node.js backend'))
  expect(built.text).toContain('1 concepts')
  expect(built.text).toContain('Stage 1 · Foundations')

  const listed = await $.command.run(roadmap())
  expect(listed.text).toContain('1. Node.js backend')

  const progress = await $.command.run(run('progress', '1'))
  expect(progress.text).toContain('Goal: Node.js backend')
  expect(progress.text).toContain('Routing: not started')
})

test('several roadmaps live side by side', async ($, on) => {
  mock.store(on)
  on('model.complete', () => answer(ROADMAP))

  await $.command.run(roadmap('Node.js backend'))
  await $.command.run(roadmap('new Docker'))
  const listed = await $.command.run(roadmap())
  expect(listed.text).toContain('1. Node.js backend')
  expect(listed.text).toContain('2. Docker')

  const all = await $.command.run(run('progress'))
  expect(all.text).toContain('Goal: Node.js backend')
  expect(all.text).toContain('Goal: Docker')
})

test('updating a roadmap keeps its progress', async ($, on) => {
  const studied = { concept: 'Routing', keywords: ['app.get'], status: 'learning', nextReviewDate: 1, repetitions: 1, interval: 1 }
  mock.store(on, { state: { roadmaps: [{ goal: 'Node.js backend', roadmap: [studied] }], pendingReview: null } })
  on('model.complete', () => answer('[{"concept":"Routing","keywords":["router.get"]},{"concept":"Streams","keywords":["pipe"]}]'))

  const updated = await $.command.run(roadmap('update 1'))
  expect(updated.text).toContain('progress kept')
  expect(updated.text).toContain('2 concepts')
  expect(updated.text).toContain('Streams: not started')
  expect(updated.text).not.toContain('Routing: not started')
})

test('update takes notes about the learner and keeps them for later updates', async ($, on) => {
  mock.store(on, { state: { roadmaps: [{ goal: 'Laravel backend', roadmap: [] }, { goal: 'Docker', roadmap: [] }], pendingReview: null } })
  const prompts: string[] = []
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)
    return answer(ROADMAP)
  })

  const updated = await $.command.run(roadmap('update 1 senior frontend dev, skip the basics'))
  expect(updated.text).toContain('Updated "Laravel backend"')
  expect(prompts[0]).toContain('"senior frontend dev, skip the basics"')

  await $.command.run(roadmap('update laravel backend'))
  expect(prompts[1]).toContain('"senior frontend dev, skip the basics"')

  const named = await $.command.run(roadmap('update docker I run compose daily'))
  expect(named.text).toContain('Updated "Docker"')
  expect(prompts[2]).toContain('"I run compose daily"')
})

test('/roadmap remove deletes a roadmap once confirmed', async ($, on) => {
  mock.store(on, { state: { roadmaps: [{ goal: 'Docker', roadmap: [] }, { goal: 'Rust', roadmap: [] }], pendingReview: null } })
  choose(on, 'Remove it')

  const removed = await $.command.run(roadmap('remove docker'))
  expect(removed.text).toContain('Removed "Docker"')
  const listed = await $.command.run(roadmap())
  expect(listed.text).not.toContain('Docker')
  expect(listed.text).toContain('1. Rust')
})

test('/roadmap remove keeps the roadmap when not confirmed', async ($, on) => {
  mock.store(on, { state: { roadmaps: [{ goal: 'Docker', roadmap: [] }], pendingReview: null } })
  choose(on, 'Keep it')

  const kept = await $.command.run(roadmap('remove 1'))
  expect(kept.text).toContain('Kept "Docker"')
})

test('a 2.0 roadmap still loads', async ($, on) => {
  mock.store(on, { state: { goal: 'Laravel', roadmap: [{ concept: 'Routing', keywords: ['route::'], status: 'learning', nextReviewDate: 0 }], pendingReview: null } })
  const listed = await $.command.run(roadmap())
  expect(listed.text).toContain('1. Laravel')
})

test('/roadmap with no roadmap explains how to start', async ($, on) => {
  mock.store(on)
  const shown = await $.command.run(roadmap())
  expect(shown.text).toContain('/companion-roadmap <goal>')
})

test('/tutor answers over the session, falling back without one', async ($, on) => {
  mock.store(on)
  on('model.fork', () => ({ value: { isAnswered: false as const, reason: 'nothing-to-fork' as const } }))
  on('model.complete', () => answer('Middleware runs before handlers.'))

  const reply = await $.command.run(run('tutor', 'what is middleware?'))
  expect(reply.text).toContain('Middleware runs before handlers.')

  const empty = await $.command.run(run('tutor'))
  expect(empty.text).toContain('/companion-tutor')
})

// The band above the prompt, as a surface asks for it.
const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the band above the prompt shows progress, due reviews and the streak (${surface})`, async ($, on) => {
    const studied = { concept: 'Routing', keywords: ['app.get'], status: 'learning', nextReviewDate: 1, repetitions: 1, interval: 1 }
    const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    mock.store(on, { state: { roadmaps: [{ goal: 'Node.js backend', roadmap: [studied, { concept: 'Streams', keywords: ['pipe'] }] }], pendingReview: null, activity: { lastDay: day(new Date()), streak: 2 } } })

    const band = await $.ui.mount({ plugin: 'learning-companion', surface, component: 'AbovePrompt', props: BAND })
    const text = (await band.find({ type: 'Box' }))?.text ?? ''
    expect(text).toContain('📚 Learning Companion')
    expect(text).toContain('0/2 mastered')
    expect(text).toContain('1 due → /companion-practice')
    expect(text).toContain('🔥 2-day streak')
  })
}

// The engine's own band, drawn when the plugin passes.
const engineBand = (on: On) =>
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: ['engine band'] }))

test('no band without a roadmap', async ($, on) => {
  engineBand(on)
  mock.store(on)
  const band = await $.ui.mount({ plugin: 'learning-companion', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect((await band.find({ type: 'Box' }))?.text).toBe('engine band')
})

test('a survey keeps the band', async ($, on) => {
  engineBand(on)
  mock.store(on, { state: { roadmaps: [{ goal: 'Docker', roadmap: [] }], pendingReview: null } })
  const band = await $.ui.mount({ plugin: 'learning-companion', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, hasSurvey: true } })
  expect((await band.find({ type: 'Box' }))?.text).toBe('engine band')
})
