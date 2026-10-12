import type { CommandInfo, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// Starts a session where `others` already hold commands; returns the names registered.
async function start($: Parameters<Parameters<typeof test>[1]>[0], on: On, others: CommandInfo[]) {
  const registered: string[] = []
  mock.store(on, {})
  on('command.list', () => ({ value: others }))
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  return registered
}

test('every command is registered as /companion-<name> and /<name> when both are free', async ($, on) => {
  const registered = await start($, on, [])
  expect(registered).toEqual([
    'companion-roadmap', 'roadmap',
    'companion-progress', 'progress',
    'companion-practice', 'practice',
    'companion-learn', 'learn',
    'companion-tutor', 'tutor',
  ])
})

test('a short name another skill holds is left to it, the prefixed one still works', async ($, on) => {
  const registered = await start($, on, [
    { name: 'anthropic-skills:learn', description: 'Learn', source: 'plugin', plugin: 'anthropic-skills' },
    { name: 'progress', description: 'Mine', source: 'user' },
  ])
  expect(registered).toContain('companion-learn')
  expect(registered).toContain('companion-progress')
  expect(registered).not.toContain('learn')
  expect(registered).not.toContain('progress')
  expect(registered).toContain('practice')
})

test('both names run the same command', async ($, on) => {
  mock.store(on, {})
  const short = await $.command.run({ command: 'learn', args: '' } as never)
  const long = await $.command.run({ command: 'companion-learn', args: '' } as never)
  expect(long.text).toBe(short.text)
  expect(long.text).toContain('/companion-roadmap <goal>')
})
