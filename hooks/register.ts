import type { EngineInterface, Register } from 'claude-code'
import {
  type Concept,
  type LearningState,
  NO_ROADMAP,
  RATINGS,
  ROADMAP_HELP,
  type Roadmap,
  applyRating,
  describeProgress,
  describeRoadmaps,
  findDueConcept,
  findRoadmap,
  findRoadmapByGoal,
  isSecretPath,
  mergeRoadmap,
  migrateState,
  parseQuiz,
  parseRating,
  parseRoadmap,
  redactSecrets,
} from './sm2'

type $ = EngineInterface

const STATE_KEY = 'state'
const MODEL = 'haiku'
const TRACKED_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit|Bash)$/

async function loadState($: $): Promise<LearningState | undefined> {
  return migrateState(await $.store.get(STATE_KEY))
}

async function saveState($: $, state: LearningState) {
  await $.store.set(STATE_KEY, state)
  showStatus($, state)
}

function showStatus($: $, state: LearningState | undefined) {
  if (!state?.roadmaps.length) return $.ui.status(undefined)
  const concepts = state.roadmaps.flatMap(r => r.roadmap)
  const mastered = concepts.filter(c => c.status === 'mastered').length
  const pending = state.pendingReview ? ` · 💡 ${state.pendingReview.concept} (review at end of turn)` : ''
  $.ui.status(`📚 ${mastered}/${concepts.length} mastered${pending}`)
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

// The file a tool call writes, if any.
function pathOf(e: unknown): string {
  const input = e as Record<string, unknown>
  const path = input.file_path ?? input.notebook_path
  return typeof path === 'string' ? path : ''
}

// Builds a roadmap for `goal`, or regenerates the one already held for it
// with the learner's progress merged in.
async function generateRoadmap($: $, goal: string): Promise<string> {
  const existing = findRoadmapByGoal(await loadState($), goal)
  const keep = existing
    ? `\nThe learner already has these concepts: ${existing.roadmap.map(c => JSON.stringify(c.concept)).join(', ')}. Keep every one that still belongs, with its name spelled exactly the same, and add what is missing.`
    : ''
  const reply = await $.model.complete({
    model: MODEL,
    maxTokens: 6000,
    timeoutMs: 120_000,
    prompt: `You are a curriculum designer. The user's goal is: "${goal}".
Create a complete learning roadmap of 12-20 key technical concepts, ordered from fundamentals to advanced, grouped into 3-6 stages (e.g. "Foundations", "Data", "Production"). Cover the topic properly: a real learner needs every one of them.${keep}
For each concept give 3-5 lowercase keywords to detect when they are coding.
Each keyword must be a whole token exactly as it appears in source code (e.g. "route::", "hasmany", "$table->"), never a fragment of a longer identifier. Prefer distinctive API or library names over common words like "get" or "data".
Return ONLY a raw JSON array of objects in learning order, with absolutely no markdown fences or extra text.
Example: [{"stage": "Foundations", "concept": "Routing", "keywords": ["express.router", "app.get", "req.params"]}]`,
  })
  if (!reply.isAnswered) return `❌ Could not generate a roadmap (${reply.reason}). Try again.`

  const fresh = parseRoadmap(reply.text)
  if (!fresh.length) return '❌ The roadmap reply was not usable JSON. Try again.'

  // Read again: a review may have rated a concept while the model worked.
  const state = (await loadState($)) ?? { roadmaps: [], pendingReview: null }
  const current = findRoadmapByGoal(state, goal)
  let roadmap: Roadmap
  if (current) {
    current.roadmap = mergeRoadmap(current.roadmap, fresh)
    roadmap = current
  } else {
    roadmap = { goal, roadmap: fresh }
    state.roadmaps.push(roadmap)
  }
  await saveState($, state)
  return [
    current
      ? `✅ Updated "${roadmap.goal}": ${roadmap.roadmap.length} concepts, progress kept.`
      : `✅ Roadmap for "${goal}": ${fresh.length} concepts.`,
    '',
    describeProgress(roadmap, Date.now()),
    '',
    'Keep coding: concepts are spotted as Claude uses them. `/progress` shows this again; `/tutor <question>` asks on the side.',
  ].join('\n')
}

// Deletes a roadmap and its progress, once the learner confirms.
async function removeRoadmap($: $, selector: string): Promise<string> {
  const found = findRoadmap(await loadState($), selector)
  if (typeof found === 'string') return found
  const count = found.roadmap.length
  try {
    const answer = await $.ui.ask(`Remove "${found.goal}" and the progress on its ${count} concepts? This cannot be undone.`, {
      header: 'Remove',
      options: ['Remove it', 'Keep it'],
    })
    if (answer !== 'Remove it') return `Kept "${found.goal}".`
  } catch {
    return `Kept "${found.goal}" (not confirmed).`
  }
  const state = await loadState($)
  if (!state) return NO_ROADMAP
  state.roadmaps = state.roadmaps.filter(r => r.goal !== found.goal)
  if (state.pendingReview?.goal === found.goal) state.pendingReview = null
  await saveState($, state)
  return `🗑️ Removed "${found.goal}".\n\n${describeRoadmaps(state, Date.now())}`
}

async function roadmapCommand($: $, args: string): Promise<string> {
  const [word = '', ...rest] = args.trim().split(/\s+/)
  const target = rest.join(' ')
  switch (word.toLowerCase()) {
    case '':
    case 'list':
      return describeRoadmaps(await loadState($), Date.now())
    case 'help':
      return ROADMAP_HELP
    case 'new':
    case 'add':
      return target ? generateRoadmap($, target) : 'Name a goal: `/roadmap new Docker`.'
    case 'update': {
      const found = findRoadmap(await loadState($), target)
      return typeof found === 'string' ? found : generateRoadmap($, found.goal)
    }
    case 'remove':
    case 'delete':
      return removeRoadmap($, target)
    default:
      return generateRoadmap($, args.trim())
  }
}

function progressCommand(state: LearningState | undefined, selector: string): string {
  const now = Date.now()
  if (!state?.roadmaps.length) return NO_ROADMAP
  if (selector) {
    const found = findRoadmap(state, selector)
    return typeof found === 'string' ? found : describeProgress(found, now)
  }
  return state.roadmaps.map(r => describeProgress(r, now)).join('\n\n────────\n\n')
}

// One lesson step: a completion about the concept, tied to the code it was spotted in.
async function teach($: $, goal: string, concept: Concept, snippet: string, task: string, maxTokens = 500) {
  const reply = await $.model.complete({
    model: MODEL,
    maxTokens,
    effort: 'low',
    timeoutMs: 30_000,
    prompt: `You are a patient programming tutor. The learner's goal is: "${goal}".
They just worked with this code: \`${snippet}\`.
The concept is "${concept.concept}".
${task}
Plain text, no markdown headings; short code lines are fine.`,
  })
  return reply.isAnswered ? reply.text.trim() : undefined
}

const LESSON = {
  example: 'Show an example',
  deeper: 'Go deeper',
  quiz: 'Quiz me',
  done: 'Rate it',
}
const MAX_LESSON_STEPS = 8

// A multiple-choice question on the concept; resolves to the verdict to show.
async function quiz($: $, goal: string, concept: Concept, snippet: string): Promise<string> {
  const reply = await $.model.complete({
    model: MODEL,
    maxTokens: 500,
    effort: 'low',
    timeoutMs: 30_000,
    prompt: `You are a programming tutor. The learner's goal is: "${goal}".
They just worked with this code: \`${snippet}\`.
Write ONE multiple-choice question that checks real understanding of "${concept.concept}" (not trivia), ideally about this code.
Exactly 4 options, each under 60 characters, all different. Only one is correct.
Return ONLY raw JSON: {"question": "...", "options": ["...", "...", "...", "..."], "answer": <index 0-3 of the correct option>, "why": "one sentence on why it is correct"}`,
  })
  const q = reply.isAnswered ? parseQuiz(reply.text) : undefined
  if (!q) return 'Quiz unavailable this time.'
  const picked = await $.ui.ask(q.question, { header: 'Quiz', options: q.options })
  const right = q.options[q.answer]
  return picked === right
    ? `✅ Correct. ${q.why}`
    : `❌ Not quite: the answer is "${right}". ${q.why}`
}

// Explanation, then as many lesson steps as the learner wants, then a rating.
async function review($: $, state: LearningState) {
  const pending = state.pendingReview
  if (!pending) return
  const { goal } = pending
  const concept = findRoadmapByGoal(state, goal)?.roadmap.find(c => c.concept === pending.concept)

  // Clear first, so a dismissed or failed review never nags again this turn.
  state.pendingReview = null
  await saveState($, state)
  if (!concept) return

  const explanation = await teach($, goal, concept, pending.snippet,
    'Explain the concept as it relates to this code: what it is, why it matters, and what this code does with it. 3-5 short sentences.', 400)
  // Each step goes in the question itself, where it is sure to be seen, and
  // in the transcript, where it stays after the question closes.
  let shown = explanation ? `💡 ${concept.concept}: ${explanation}` : `Explanation unavailable for "${concept.concept}".`
  $.ui.log(shown)

  try {
    for (let step = 0; step < MAX_LESSON_STEPS; step++) {
      const choice = await $.ui.ask(`${shown}\n\nWhat next? (Or type a question under Other.)`, {
        header: 'Lesson',
        options: Object.values(LESSON),
      })
      if (choice === LESSON.done) break
      const text = choice === LESSON.example
        ? await teach($, goal, concept, pending.snippet,
          'Show one short, different code example of the concept in a realistic situation, then one sentence on what to notice.')
        : choice === LESSON.deeper
          ? await teach($, goal, concept, pending.snippet,
            'Go one level deeper: how it works underneath, one common mistake, and when not to use it. 4-6 short sentences.')
          : choice === LESSON.quiz
            ? await quiz($, goal, concept, pending.snippet)
            : await teach($, goal, concept, pending.snippet,
              `The learner asks: "${choice}". Answer it directly, in 2-5 short sentences.`)
      const label = Object.values(LESSON).includes(choice) ? choice : `❓ ${choice}`
      shown = text ? `${label}\n${text}` : `${label}: unavailable this time.`
      $.ui.log(shown)
    }

    const answer = await $.ui.ask(`How well do you understand "${concept.concept}" now?`, {
      header: 'Review',
      options: Object.keys(RATINGS),
    })
    const quality = parseRating(answer)
    if (quality === undefined) return

    // Read again: the roadmaps may have changed while the lesson was open.
    const latest = await loadState($)
    const roadmap = findRoadmapByGoal(latest, goal)
    const current = roadmap?.roadmap.find(c => c.concept === concept.concept)
    if (!latest || !roadmap || !current) return
    const rated = applyRating(current, quality, Date.now())
    roadmap.roadmap = roadmap.roadmap.map(c => (c.concept === rated.concept ? rated : c))
    await saveState($, latest)
    $.ui.toast(
      rated.status === 'mastered'
        ? `🎉 "${rated.concept}" mastered!`
        : `📅 "${rated.concept}": next review ${new Date(rated.nextReviewDate).toLocaleDateString()}`,
    )
  } catch {
    // dismissed, or no one to ask (-p)
  }
}

// A side question, answered over the session's own conversation as /btw is.
async function tutor($: $, question: string): Promise<string> {
  const state = await loadState($)
  const roadmap = (state?.roadmaps ?? [])
    .map(r => `The user is learning "${r.goal}"; that roadmap: ${r.roadmap.map(c => c.concept).join(', ')}.\n`)
    .join('')
  const prompt = `${roadmap}Side question from the user, answered as a patient tutor, not as a task: do not use tools or change anything. Use the conversation so far when it helps. Plain text, under 200 words, short code lines are fine.

Question: ${question}`
  let reply = await $.model.fork({ prompt })
  // No conversation yet (new session, after /clear): answer without it.
  if (!reply.isAnswered && reply.reason === 'nothing-to-fork') {
    reply = await $.model.complete({ model: MODEL, maxTokens: 800, timeoutMs: 60_000, prompt })
  }
  return reply.isAnswered ? `🎓 ${reply.text.trim()}` : `❌ No answer (${reply.reason}). Try again.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A name another command or skill already holds is refused; keep the rest working.
    const commands = [
      { name: 'roadmap', description: 'Learning companion: list your roadmaps, add one for a goal, update or remove one', argumentHint: '[goal | update <#> | remove <#>]' },
      { name: 'progress', description: 'Learning companion: your roadmaps by stage and what is due', argumentHint: '[# | goal]' },
      { name: 'tutor', description: 'Learning companion: ask the tutor a side question', argumentHint: '<question>', immediate: true as const },
    ]
    for (const command of commands) {
      await $.command.register(command).catch((err: unknown) =>
        $.ui.toast(`/${command.name} unavailable: ${err instanceof Error ? err.message : String(err)}`))
    }
    showStatus($, await loadState($))
    return next(e)
  })

  on('command.run', { command: 'roadmap' }, async ($, e) => ({
    text: await roadmapCommand($, e.args ?? ''),
  }))

  on('command.run', { command: 'progress' }, async ($, e) => ({
    text: progressCommand(await loadState($), (e.args ?? '').trim()),
  }))

  on('command.run', { command: 'tutor' }, async ($, e) => {
    const question = (e.args ?? '').trim()
    if (!question) return { text: 'Ask a question: `/tutor why use middleware instead of a helper function?`' }
    return { text: await tutor($, question) }
  })

  // Spot roadmap concepts in what Claude writes or runs. Only flags the
  // concept: the explanation and the rating wait for the end of the turn,
  // so the tool call itself is never slowed down.
  on('tool.call', { tool: TRACKED_TOOLS }, async ($, e, next) => {
    const state = await loadState($)
    // Secret files (.env, keys, credentials) are never read or stored.
    if (state && !state.pendingReview && !isSecretPath(pathOf(e))) {
      const code = codeOf(e)
      const due = findDueConcept(state, code, Date.now())
      if (due) {
        const { goal, concept } = due
        state.pendingReview = { goal, concept: concept.concept, snippet: redactSecrets(code).slice(0, 500) }
        await saveState($, state)
        $.ui.toast(`💡 Spotted: ${concept.concept}`, { timeoutMs: 10_000 })
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
