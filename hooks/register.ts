import type { EngineInterface, Register } from 'claude-code'
import {
  type LearningState,
  RATINGS,
  applyRating,
  findDueConcept,
  parseRating,
  parseRoadmap,
} from './sm2'

type $ = EngineInterface

const STATE_KEY = 'state'
const MODEL = 'haiku'
const TRACKED_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit|Bash)$/

async function loadState($: $): Promise<LearningState | undefined> {
  const state = (await $.store.get(STATE_KEY)) as LearningState | undefined
  return state && Array.isArray(state.roadmap) ? state : undefined
}

async function saveState($: $, state: LearningState) {
  await $.store.set(STATE_KEY, state)
  showStatus($, state)
}

function showStatus($: $, state: LearningState | undefined) {
  if (!state) return $.ui.status(undefined)
  const mastered = state.roadmap.filter(c => c.status === 'mastered').length
  $.ui.status(`📚 ${mastered}/${state.roadmap.length} mastered`)
}

// The code a tool call writes or runs, from whichever input fields it has.
function codeOf(e: unknown): string {
  const input = e as Record<string, unknown>
  const parts = [input.command, input.content, input.new_string, input.new_source]
  if (Array.isArray(input.edits)) {
    for (const edit of input.edits) parts.push((edit as Record<string, unknown>)?.new_string)
  }
  return parts.filter((p): p is string => typeof p === 'string').join('\n')
}

async function generateRoadmap($: $, goal: string): Promise<string> {
  const reply = await $.model.complete({
    model: MODEL,
    maxTokens: 1500,
    timeoutMs: 60_000,
    prompt: `You are a curriculum designer. The user's goal is: "${goal}".
Create a list of 5 key technical concepts they need to learn, with 3-5 lowercase keywords for each to detect when they are coding.
Prefer distinctive keywords (API names, library names) over common words like "get" or "data".
Return ONLY a raw JSON array of objects, with absolutely no markdown fences or extra text.
Example: [{"concept": "Routing", "keywords": ["express.router", "app.get", "req.params"]}]`,
  })
  if (!reply.isAnswered) return `❌ Could not generate a roadmap (${reply.reason}). Try again.`

  const roadmap = parseRoadmap(reply.text)
  if (!roadmap.length) return '❌ The roadmap reply was not usable JSON. Try again.'

  await saveState($, { goal, roadmap, pendingReview: null })
  return [
    `✅ Roadmap for "${goal}". Tracking:`,
    ...roadmap.map(c => `  - ${c.concept} (${c.keywords.join(', ')})`),
  ].join('\n')
}

function describeRoadmap(state: LearningState | undefined): string {
  if (!state) return 'No roadmap yet. Start one with `/roadmap <goal>`, e.g. `/roadmap Node.js backend`.'
  const now = Date.now()
  return [
    `🎯 Goal: ${state.goal}`,
    ...state.roadmap.map(c => {
      const when = c.status === 'mastered'
        ? 'mastered'
        : !c.nextReviewDate || c.nextReviewDate <= now
          ? 'due'
          : `next review ${new Date(c.nextReviewDate).toLocaleDateString()}`
      return `  - ${c.concept}: ${when}`
    }),
  ].join('\n')
}

async function review($: $, state: LearningState) {
  const pending = state.pendingReview
  if (!pending) return
  const concept = state.roadmap.find(c => c.concept === pending.concept)

  // Clear first, so a dismissed or failed review never nags again this turn.
  state.pendingReview = null
  await saveState($, state)
  if (!concept) return

  const explanation = await $.model.complete({
    model: MODEL,
    maxTokens: 200,
    effort: 'low',
    timeoutMs: 8000,
    prompt: `You are a concise programming tutor. The user's goal is: "${state.goal}".
They just worked with this code: \`${pending.snippet}\`.
Explain "${concept.concept}" strictly as it relates to this context. Exactly 1-2 short sentences. Plain text, no markdown.`,
  })
  if (explanation.isAnswered) {
    await $.session
      .append({
        message: {
          type: 'system',
          content: [{ type: 'text', text: `💡 ${concept.concept}: ${explanation.text.trim()}` }],
        },
      })
      .catch(() => $.ui.toast(`💡 ${concept.concept}: ${explanation.text.trim()}`, { timeoutMs: 15_000 }))
  }

  let answer: string
  try {
    answer = await $.ui.ask(`How well do you understand "${concept.concept}"?`, {
      header: 'Review',
      options: Object.keys(RATINGS),
    })
  } catch {
    return // dismissed, or no one to ask (-p)
  }
  const quality = parseRating(answer)
  if (quality === undefined) return

  const rated = applyRating(concept, quality, Date.now())
  state.roadmap = state.roadmap.map(c => (c.concept === rated.concept ? rated : c))
  await saveState($, state)
  $.ui.toast(
    rated.status === 'mastered'
      ? `🎉 "${rated.concept}" mastered!`
      : `📅 "${rated.concept}": next review ${new Date(rated.nextReviewDate).toLocaleDateString()}`,
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A name another command or skill already holds is refused; keep the rest working.
    await $.command
      .register({
        name: 'roadmap',
        description: 'Learning companion: show your roadmap, or start a new one with a goal',
        argumentHint: '[goal]',
      })
      .catch((err: unknown) => $.ui.toast(`/roadmap unavailable: ${err instanceof Error ? err.message : String(err)}`))
    showStatus($, await loadState($))
    return next(e)
  })

  on('command.run', { command: 'roadmap' }, async ($, e) => {
    const goal = (e.args ?? '').trim()
    if (!goal) return { text: describeRoadmap(await loadState($)) }
    return { text: await generateRoadmap($, goal) }
  })

  // Spot roadmap concepts in what Claude writes or runs. Only flags the
  // concept: the explanation and the rating wait for the end of the turn,
  // so the tool call itself is never slowed down.
  on('tool.call', { tool: TRACKED_TOOLS }, async ($, e, next) => {
    const state = await loadState($)
    if (state && !state.pendingReview) {
      const code = codeOf(e)
      const concept = findDueConcept(state, code, Date.now())
      if (concept) {
        state.pendingReview = { concept: concept.concept, snippet: code.slice(0, 500) }
        await saveState($, state)
        $.ui.toast(`💡 Roadmap concept spotted: ${concept.concept}. Quick review when this turn ends.`)
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && !e.isAborted) {
      const state = await loadState($)
      if (state?.pendingReview) await review($, state)
    }
    return result
  })
}
