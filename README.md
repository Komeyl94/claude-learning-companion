# Learning Companion

A Claude Code plugin that spots concepts from your learning roadmap while Claude writes or runs code, explains them in context, and schedules reviews with spaced repetition (SM-2).

Built as a **mod** (function-hook plugin). Requires a Claude Code version with function hooks (2.1.288 or later). No API key needed: model calls go through your Claude Code session.

## Install

```
claude plugin marketplace add Komeyl94/claude-learning-companion
claude plugin install learning-companion@learning-companion
```

For local development:

```
claude --plugin-dir ./claude-learning-companion
```

## Use

1. `/roadmap Node.js backend`: generate a 12–20 concept roadmap, ordered into stages, with detection keywords.
2. Work normally. When Claude writes or runs code that matches a due concept, a toast says so.
3. When the turn ends you get a short lesson tied to that code. Pick what comes next, as many times as you like:
   - **Show an example**: a different, realistic example
   - **Go deeper**: how it works underneath, a common mistake, when not to use it
   - **Quiz me**: a multiple-choice question, checked on the spot
   - **Other**: type your own question about the concept
   - **Rate it**: Forgot it / Hard / Good / Easy (or 0–5 under Other) schedules the next review
4. `/progress`: every roadmap by stage, what is mastered, learning, due, or not started. `/progress 2` (or `/progress docker`) shows one.
5. `/tutor <question>`: ask a side question at any time, even mid-turn. It sees the current conversation, like `/btw`, and changes nothing.

### Several roadmaps

You can learn more than one thing at once: concepts are spotted from every roadmap.

| Command | Does |
| --- | --- |
| `/roadmap` | Lists your roadmaps, one line each |
| `/roadmap <goal>` | Adds a roadmap; for a goal you already have, updates it instead |
| `/roadmap update <#\|name>` | Regenerates a roadmap, keeping your progress. Concepts you have studied are never dropped |
| `/roadmap remove <#\|name>` | Deletes a roadmap and its progress, after you confirm |

A roadmap is named by its number in `/roadmap`, its goal, or a unique part of the goal.

State is kept in the plugin's own store across sessions.

## Privacy

- Model calls go through your own Claude Code session; nothing is sent anywhere else.
- Writes to secret files (`.env*`, `*.pem`, `*.key`, SSH keys, `credentials`, `secrets.*`, `.npmrc`, `.netrc`) are ignored entirely.
- For other code, up to 500 characters are kept until the review ends, with secret-looking values (API keys, tokens, passwords, URL credentials, private keys) replaced by `[REDACTED]`.

## Develop

```
claude plugin validate --strict .
claude plugin test .
```

| File | Role |
| --- | --- |
| `hooks/register.ts` | Hooks: `session.start`, `command.run` (`/roadmap`, `/progress`, `/tutor`), `tool.call` (spot concepts), `turn.complete` (lesson + rate) |
| `hooks/sm2.ts` | Pure logic: SM-2, keyword matching, roadmap, quiz and rating parsing, progress view |
| `tests/` | `claude plugin test` suites |
