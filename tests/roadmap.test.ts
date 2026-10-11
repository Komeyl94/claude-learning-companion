import type { CommandRunInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// The engine stamps `origin` and `presentation` on a real run.
const roadmap = (args = '') => ({ command: 'roadmap', args }) as unknown as CommandRunInput

const ROADMAP = '[{"concept":"Routing","keywords":["app.get"]}]'

test('/roadmap <goal> builds a roadmap and /roadmap shows it', async ($, on) => {
  mock.store(on)
  on('model.complete', () => ({
    value: {
      isAnswered: true as const,
      text: ROADMAP,
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }))

  const built = await $.command.run(roadmap('Node.js backend'))
  expect(built.text).toContain('Routing (app.get)')

  const shown = await $.command.run(roadmap())
  expect(shown.text).toContain('Goal: Node.js backend')
  expect(shown.text).toContain('Routing: due')
})

test('/roadmap with no roadmap explains how to start', async ($, on) => {
  mock.store(on)
  const shown = await $.command.run(roadmap())
  expect(shown.text).toContain('/roadmap <goal>')
})
