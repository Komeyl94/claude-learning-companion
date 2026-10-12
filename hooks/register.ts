import type { EngineInterface, PluginOptions, Register } from 'claude-code'
import {
  type Concept,
  type LearningState,
  NO_ROADMAP,
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
import {
  currentStreak,
  dueConcepts,
  lessonsToday,
  nextNewConcept,
  noteSection,
  notePath,
  parseShared,
  ratingOptions,
  recordLesson,
  recordStudy,
  slug,
  suggestRating,
  toAnki,
  toShareJson,
} from './study'

type $ = EngineInterface

const STATE_KEY = 'state'
const TRACKED_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit|Bash)$/

// The plugin's /config fields (plugin.json `userConfig`), defaults filled in.
type Settings = {
  model: string
  autoLessons: boolean
  maxLessonsPerDay: number
  notesDir: string
}

const DEFAULTS: Settings = { model: 'haiku', autoLessons: true, maxLessonsPerDay: 5, notesDir: '~/learning-notes' }

function settingsOf(options: PluginOptions | undefined): Settings {
  const o = options ?? {}
  return {
    model: typeof o.lessonModel === 'string' && o.lessonModel ? o.lessonModel : DEFAULTS.model,
    autoLessons: typeof o.autoLessons === 'boolean' ? o.autoLessons : DEFAULTS.autoLessons,
    maxLessonsPerDay: typeof o.maxLessonsPerDay === 'number' ? Math.max(0, o.maxLessonsPerDay) : DEFAULTS.maxLessonsPerDay,
    notesDir: typeof o.notesDir === 'string' ? o.notesDir.trim() : DEFAULTS.notesDir,
  }
}

let settings = DEFAULTS

async function loadState($: $): Promise<LearningState | undefined> {
  return migrateState(await $.store.get(STATE_KEY))
}

async function saveState($: $, state: LearningState) {
  await $.store.set(STATE_KEY, state)
  showStatus($, state)
}

function showStatus($: $, state: LearningState | undefined) {
  if (!state?.roadmaps.length) return $.ui.status(undefined)
  const now = Date.now()
  const concepts = state.roadmaps.flatMap(r => r.roadmap)
  const mastered = concepts.filter(c => c.status === 'mastered').length
  const due = dueConcepts(state, now).length
  const streak = currentStreak(state.activity, now)
  const parts = [
    `📚 ${mastered}/${concepts.length} mastered`,
    due ? `${due} due (/practice)` : '',
    streak ? `🔥 ${streak}-day streak` : '',
    state.pendingReview ? `💡 ${state.pendingReview.concept} (lesson at end of turn)` : '',
  ]
  $.ui.status(parts.filter(Boolean).join(' · '))
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

// `~/x` as an absolute path.
async function expandHome($: $, path: string): Promise<string> {
  if (!path.startsWith('~')) return path
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  return home + path.slice(1)
}

// --- Roadmaps ---

// Dependency manifests in the working directory, so keywords match the stack
// the learner actually uses.
const MANIFESTS = ['package.json', 'composer.json', 'requirements.txt', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'Gemfile', 'pom.xml', 'build.gradle']

async function projectStack($: $): Promise<string> {
  const found: string[] = []
  for (const name of MANIFESTS) {
    const text = await $.fs.read(name).catch(() => undefined)
    if (typeof text === 'string') found.push(`--- ${name} ---\n${redactSecrets(text).slice(0, 1500)}`)
  }
  return found.join('\n')
}

// Builds a roadmap for `goal`, or regenerates the one already held for it
// with the learner's progress merged in.
async function generateRoadmap($: $, goal: string): Promise<string> {
  const existing = findRoadmapByGoal(await loadState($), goal)
  const keep = existing
    ? `\nThe learner already has these concepts: ${existing.roadmap.map(c => JSON.stringify(c.concept)).join(', ')}. Keep every one that still belongs, with its name spelled exactly the same, and add what is missing.`
    : ''
  const stack = await projectStack($)
  const project = stack
    ? `\nThe learner's current project declares these dependencies. Where they fit the goal, use these libraries' real API names as keywords:\n${stack}\n`
    : ''
  const reply = await $.model.complete({
    model: settings.model,
    maxTokens: 6000,
    timeoutMs: 120_000,
    prompt: `You are a curriculum designer. The user's goal is: "${goal}".
Create a complete learning roadmap of 12-20 key technical concepts, ordered from fundamentals to advanced, grouped into 3-6 stages (e.g. "Foundations", "Data", "Production"). Cover the topic properly: a real learner needs every one of them.${keep}
${project}For each concept give 3-5 lowercase keywords to detect when they are coding.
Each keyword must be a whole token exactly as it appears in source code (e.g. "route::", "hasmany", "$table->"), never a fragment of a longer identifier. Prefer distinctive API or library names over common words like "get" or "data". Never use file names or paths (".env", "config/", "package.json").
Return ONLY a raw JSON array of objects in learning order, with absolutely no markdown fences or extra text.
Example: [{"stage": "Foundations", "concept": "Routing", "keywords": ["express.router", "app.get", "req.params"]}]`,
  })
  if (!reply.isAnswered) return `❌ Could not generate a roadmap (${reply.reason}). Try again.`

  const fresh = parseRoadmap(reply.text)
  if (!fresh.length) return '❌ The roadmap reply was not usable JSON. Try again.'
  return addRoadmap($, { goal, roadmap: fresh })
}

// Adds a roadmap, or merges it into the one already held for its goal.
async function addRoadmap($: $, incoming: Roadmap): Promise<string> {
  // Read again: a lesson may have rated a concept while the model worked.
  const state = (await loadState($)) ?? { roadmaps: [], pendingReview: null }
  const current = findRoadmapByGoal(state, incoming.goal)
  let roadmap: Roadmap
  if (current) {
    current.roadmap = mergeRoadmap(current.roadmap, incoming.roadmap)
    roadmap = current
  } else {
    roadmap = incoming
    state.roadmaps.push(roadmap)
  }
  await saveState($, state)
  return [
    current
      ? `✅ Updated "${roadmap.goal}": ${roadmap.roadmap.length} concepts, progress kept.`
      : `✅ Roadmap for "${roadmap.goal}": ${roadmap.roadmap.length} concepts.`,
    '',
    describeProgress(roadmap, Date.now()),
    '',
    'Keep coding: concepts are spotted as Claude uses them. `/learn` starts the next one now; `/tutor <question>` asks on the side.',
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

// One line per concept for an Anki card's back, from one completion.
async function cardBacks($: $, roadmap: Roadmap): Promise<Record<string, string>> {
  const reply = await $.model.complete({
    model: settings.model,
    maxTokens: 4000,
    timeoutMs: 120_000,
    prompt: `For a learner whose goal is "${roadmap.goal}", define each concept below in 1-2 plain sentences, as the back of a flashcard.
Concepts: ${JSON.stringify(roadmap.roadmap.map(c => c.concept))}
Return ONLY a raw JSON object mapping each concept, spelled exactly as given, to its definition.`,
  })
  if (!reply.isAnswered) return {}
  const start = reply.text.indexOf('{')
  const end = reply.text.lastIndexOf('}')
  try {
    const raw = JSON.parse(reply.text.slice(start, end + 1)) as Record<string, unknown>
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string'))
  } catch {
    return {}
  }
}

// `/roadmap export <#|name> [json|anki]`: a file in the working directory.
async function exportRoadmap($: $, args: string): Promise<string> {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const last = words.at(-1)?.toLowerCase()
  const format = last === 'anki' || last === 'json' ? last : 'json'
  if (last === format) words.pop()
  const found = findRoadmap(await loadState($), words.join(' '))
  if (typeof found === 'string') return found
  if (format === 'anki') {
    const path = `${slug(found.goal)}.anki.txt`
    await $.fs.write(path, toAnki(found, await cardBacks($, found)))
    return `📤 Wrote ${found.roadmap.length} Anki cards to ${path}. In Anki: File → Import, then pick the file.`
  }
  const path = `${slug(found.goal)}.roadmap.json`
  await $.fs.write(path, toShareJson(found))
  return `📤 Wrote "${found.goal}" to ${path}, without your progress. Share it; others add it with \`/roadmap import ${path}\`.`
}

// `/roadmap import <file>`: a shared roadmap, merged into one of the same goal.
async function importRoadmap($: $, path: string): Promise<string> {
  if (!path) return 'Name the file: `/roadmap import laravel-backend.roadmap.json`.'
  const text = await $.fs.read(path).catch(() => undefined)
  if (typeof text !== 'string') return `❌ Could not read ${path}.`
  const shared = parseShared(text)
  if (!shared) return `❌ ${path} is not a shared roadmap (made with \`/roadmap export\`).`
  return addRoadmap($, shared)
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
    case 'export':
      return exportRoadmap($, target)
    case 'import':
      return importRoadmap($, target)
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

// --- Lessons ---

// The code a lesson is about, or how to teach without any.
const codeContext = (snippet: string | undefined) =>
  snippet
    ? `They just worked with this code: \`${snippet}\`.`
    : 'There is no code in front of them: use a small example of your own.'

// One lesson step: a completion about the concept.
async function teach($: $, goal: string, concept: Concept, snippet: string | undefined, task: string, maxTokens = 500) {
  const reply = await $.model.complete({
    model: settings.model,
    maxTokens,
    effort: 'low',
    timeoutMs: 30_000,
    prompt: `You are a patient programming tutor. The learner's goal is: "${goal}".
${codeContext(snippet)}
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

// A multiple-choice question on the concept: the verdict to show, and whether
// it was answered right (undefined when no quiz could be made).
async function quiz($: $, goal: string, concept: Concept, snippet: string | undefined) {
  const reply = await $.model.complete({
    model: settings.model,
    maxTokens: 500,
    effort: 'low',
    timeoutMs: 30_000,
    prompt: `You are a programming tutor. The learner's goal is: "${goal}".
${codeContext(snippet)}
Write ONE multiple-choice question that checks real understanding of "${concept.concept}" (not trivia)${snippet ? ', ideally about this code' : ''}.
Exactly 4 options, each under 60 characters, all different. Only one is correct.
Return ONLY raw JSON: {"question": "...", "options": ["...", "...", "...", "..."], "answer": <index 0-3 of the correct option>, "why": "one sentence on why it is correct"}`,
  })
  const q = reply.isAnswered ? parseQuiz(reply.text) : undefined
  if (!q) return { text: 'Quiz unavailable this time.', correct: undefined }
  const picked = await $.ui.ask(q.question, { header: 'Quiz', options: q.options })
  const right = q.options[q.answer]
  const correct = picked === right
  return {
    text: `Q: ${q.question}\n${correct ? `✅ Correct. ${q.why}` : `❌ Not quite: the answer is "${right}". ${q.why}`}`,
    correct,
  }
}

// Appends the lesson to the concept's notes file, when notes are on.
async function saveNotes($: $, goal: string, concept: Concept, steps: string[]) {
  if (!settings.notesDir || !steps.length) return
  try {
    const path = notePath(await expandHome($, settings.notesDir), goal, concept.concept)
    const before = await $.fs.read(path).catch(() => undefined)
    const isNew = typeof before !== 'string'
    const section = noteSection({ goal, concept: concept.concept, steps, now: Date.now(), isNew })
    await $.fs.write(path, (isNew ? '' : before) + section)
  } catch (err) {
    $.ui.log(`Notes not saved: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
  }
}

type LessonOutcome = 'rated' | 'skipped' | 'stopped'

// Explanation, then as many lesson steps as the learner wants, then a rating.
// `stopped` when the learner closed a dialog.
async function lesson($: $, goal: string, concept: Concept, snippet: string | undefined, heading = ''): Promise<LessonOutcome> {
  const explain = snippet
    ? 'Explain the concept as it relates to this code: what it is, why it matters, and what this code does with it. 3-5 short sentences.'
    : 'Explain the concept from scratch: what it is, why it matters, and a tiny example. 3-5 short sentences.'
  const explanation = await teach($, goal, concept, snippet, explain, 400)
  const steps: string[] = []
  const quizResults: boolean[] = []
  // Each step goes in the question itself, where it is sure to be seen, and
  // in the transcript, where it stays after the question closes.
  let shown = explanation ? `💡 ${concept.concept}: ${explanation}` : `Explanation unavailable for "${concept.concept}".`
  if (heading) shown = `${heading}\n${shown}`
  if (explanation) steps.push(explanation)
  $.ui.log(shown)

  try {
    for (let step = 0; step < MAX_LESSON_STEPS; step++) {
      const choice = await $.ui.ask(`${shown}\n\nWhat next? (Or type a question under Other.)`, {
        header: 'Lesson',
        options: Object.values(LESSON),
      })
      if (choice === LESSON.done) break
      let text: string | undefined
      if (choice === LESSON.quiz) {
        const result = await quiz($, goal, concept, snippet)
        if (result.correct !== undefined) quizResults.push(result.correct)
        text = result.text
      } else {
        text = await teach($, goal, concept, snippet,
          choice === LESSON.example
            ? 'Show one short, different code example of the concept in a realistic situation, then one sentence on what to notice.'
            : choice === LESSON.deeper
              ? 'Go one level deeper: how it works underneath, one common mistake, and when not to use it. 4-6 short sentences.'
              : `The learner asks: "${choice}". Answer it directly, in 2-5 short sentences.`)
      }
      const label = Object.values(LESSON).includes(choice) ? choice : `❓ ${choice}`
      shown = text ? `${label}\n${text}` : `${label}: unavailable this time.`
      if (text) steps.push(`### ${label}\n\n${text}`)
      $.ui.log(shown)
    }

    const suggested = suggestRating(quizResults)
    const answer = await $.ui.ask(
      `How well do you understand "${concept.concept}" now?${suggested ? ` (Your quiz suggests: ${suggested}.)` : ''}`,
      { header: 'Review', options: ratingOptions(suggested) },
    )
    const quality = parseRating(answer)
    if (quality === undefined) return 'skipped'

    // Read again: the roadmaps may have changed while the lesson was open.
    const latest = await loadState($)
    const roadmap = findRoadmapByGoal(latest, goal)
    const current = roadmap?.roadmap.find(c => c.concept === concept.concept)
    if (!latest || !roadmap || !current) return 'skipped'
    const rated = applyRating(current, quality, Date.now())
    roadmap.roadmap = roadmap.roadmap.map(c => (c.concept === rated.concept ? rated : c))
    latest.activity = recordStudy(latest.activity, Date.now())
    await saveState($, latest)
    $.ui.toast(
      rated.status === 'mastered'
        ? `🎉 "${rated.concept}" mastered!`
        : `📅 "${rated.concept}": next review ${new Date(rated.nextReviewDate).toLocaleDateString()}`,
    )
    return 'rated'
  } catch {
    return 'stopped' // dismissed, or no one to ask (-p)
  } finally {
    await saveNotes($, goal, concept, steps)
  }
}

// The lesson for the concept spotted this turn.
async function spottedLesson($: $, state: LearningState) {
  const pending = state.pendingReview
  if (!pending) return
  // Clear first, so a dismissed or failed lesson never nags again this turn.
  // Counted against the daily cap of automatic lessons.
  state.pendingReview = null
  state.activity = recordLesson(state.activity, Date.now())
  await saveState($, state)
  const concept = findRoadmapByGoal(state, pending.goal)?.roadmap.find(c => c.concept === pending.concept)
  if (concept) await lesson($, pending.goal, concept, pending.snippet)
}

// `/practice [#|name]`: every due concept, one lesson after another.
async function practiceCommand($: $, selector: string): Promise<string> {
  const state = await loadState($)
  if (!state?.roadmaps.length) return NO_ROADMAP
  const now = Date.now()
  let goal: string | undefined
  if (selector) {
    const found = findRoadmap(state, selector)
    if (typeof found === 'string') return found
    goal = found.goal
  }
  const due = dueConcepts(state, now).filter(d => !goal || d.goal === goal)
  if (!due.length) {
    const next = state.roadmaps
      .flatMap(r => r.roadmap)
      .filter(c => c.status !== 'mastered' && c.nextReviewDate > now)
      .sort((a, b) => a.nextReviewDate - b.nextReviewDate)[0]
    return [
      '✅ Nothing due for review.',
      next ? `Next: "${next.concept}" on ${new Date(next.nextReviewDate).toLocaleDateString()}.` : '',
      'Start something new with `/learn`.',
    ].filter(Boolean).join(' ')
  }
  let rated = 0
  for (const [i, { goal, concept }] of due.entries()) {
    const outcome = await lesson($, goal, concept, undefined, `🔁 Review ${i + 1} of ${due.length}`)
    if (outcome === 'stopped') break
    if (outcome === 'rated') rated += 1
  }
  const left = due.length - rated
  return `🔁 Reviewed ${rated} of ${due.length}.${left ? ` ${left} still due: \`/practice\` picks up where you left off.` : ' All caught up.'}`
}

// `/learn [#|name]`: the next concept never studied, in roadmap order.
async function learnCommand($: $, selector: string): Promise<string> {
  const state = await loadState($)
  if (!state?.roadmaps.length) return NO_ROADMAP
  let roadmaps = state.roadmaps
  if (selector && selector.toLowerCase() !== 'next') {
    const found = findRoadmap(state, selector)
    if (typeof found === 'string') return found
    roadmaps = [found]
  }
  const pick = roadmaps.map(r => ({ goal: r.goal, concept: nextNewConcept(r) })).find(p => p.concept)
  if (!pick?.concept) return '🎉 Every concept has been started. `/practice` keeps them fresh.'
  const outcome = await lesson($, pick.goal, pick.concept, undefined, `🆕 New concept from "${pick.goal}"`)
  return outcome === 'rated'
    ? `🆕 Learned "${pick.concept.concept}". \`/learn\` again for the next one.`
    : `Stopped "${pick.concept.concept}". \`/learn\` starts it again.`
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
    reply = await $.model.complete({ model: settings.model, maxTokens: 800, timeoutMs: 60_000, prompt })
  }
  return reply.isAnswered ? `🎓 ${reply.text.trim()}` : `❌ No answer (${reply.reason}). Try again.`
}

export const register: Register = (on, options) => {
  settings = settingsOf(options)

  on('session.start', async ($, e, next) => {
    // A name another command or skill already holds is refused; keep the rest working.
    const commands = [
      { name: 'roadmap', description: 'Learning companion: list, add, update, remove, export or import roadmaps', argumentHint: '[goal | update <#> | remove <#> | export <#> [anki] | import <file>]' },
      { name: 'progress', description: 'Learning companion: your roadmaps by stage and what is due', argumentHint: '[# | goal]' },
      { name: 'practice', description: 'Learning companion: review every concept that is due', argumentHint: '[# | goal]' },
      { name: 'learn', description: 'Learning companion: learn the next new concept on your roadmap', argumentHint: '[# | goal]' },
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

  on('command.run', { command: 'practice' }, async ($, e) => ({
    text: await practiceCommand($, (e.args ?? '').trim()),
  }))

  on('command.run', { command: 'learn' }, async ($, e) => ({
    text: await learnCommand($, (e.args ?? '').trim()),
  }))

  on('command.run', { command: 'tutor' }, async ($, e) => {
    const question = (e.args ?? '').trim()
    if (!question) return { text: 'Ask a question: `/tutor why use middleware instead of a helper function?`' }
    return { text: await tutor($, question) }
  })

  // Spot roadmap concepts in what Claude writes or runs. Only flags the
  // concept: the lesson waits for the end of the turn, so the tool call
  // itself is never slowed down.
  on('tool.call', { tool: TRACKED_TOOLS }, async ($, e, next) => {
    if (!settings.autoLessons) return next(e)
    const state = await loadState($)
    const capped = settings.maxLessonsPerDay > 0 && lessonsToday(state?.activity, Date.now()) >= settings.maxLessonsPerDay
    // Secret files (.env, keys, credentials) are never read or stored.
    if (state && !state.pendingReview && !capped && !isSecretPath(pathOf(e))) {
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
      if (state?.pendingReview) await spottedLesson($, state)
    }
    return result
  })
}
