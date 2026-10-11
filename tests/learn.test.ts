import type { CommandRunInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// The engine stamps `origin` and `presentation` on a real run.
const learn = (args = '') => ({ command: 'learn', args }) as unknown as CommandRunInput

const ROADMAP = '[{"concept":"Routing","keywords":["app.get"]}]'

test('/learn <goal> builds a roadmap and /learn shows it', async ($, on) => {
  mock.store(on)
  on('model.complete', () => ({
    value: {
      isAnswered: true as const,
      text: ROADMAP,
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }))

  const built = await $.command.run(learn('Node.js backend'))
  expect(built.text).toContain('Routing (app.get)')

  const shown = await $.command.run(learn())
  expect(shown.text).toContain('Goal: Node.js backend')
  expect(shown.text).toContain('Routing: due')
})

test('/learn with no roadmap explains how to start', async ($, on) => {
  mock.store(on)
  const shown = await $.command.run(learn())
  expect(shown.text).toContain('/learn <goal>')
})
