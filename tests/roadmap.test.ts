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
  expect(shown.text).toContain('/roadmap <goal>')
})

test('/tutor answers over the session, falling back without one', async ($, on) => {
  mock.store(on)
  on('model.fork', () => ({ value: { isAnswered: false as const, reason: 'nothing-to-fork' as const } }))
  on('model.complete', () => answer('Middleware runs before handlers.'))

  const reply = await $.command.run(run('tutor', 'what is middleware?'))
  expect(reply.text).toContain('Middleware runs before handlers.')

  const empty = await $.command.run(run('tutor'))
  expect(empty.text).toContain('/tutor')
})
