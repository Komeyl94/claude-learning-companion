# Learning Companion

A Claude Code plugin that spots concepts from your learning roadmap while Claude writes or runs code, explains them in context, and schedules reviews with spaced repetition (SM-2).

Built as a **mod** (function-hook plugin). Requires a Claude Code version with function hooks (2.1.288 or later). No API key needed: model calls go through your Claude Code session.

## Install

```
claude plugin marketplace add <path-or-git-url-of-this-repo>
claude plugin install learning-companion@learning-companion
```

For local development:

```
claude --plugin-dir ./claude-learning-companion
```

## Use

1. `/learn Node.js backend`: generate a 5-concept roadmap with detection keywords.
2. Work normally. When Claude writes or runs code that matches a due concept, a toast says so.
3. When the turn ends you get a 1–2 sentence explanation tied to that code and a native question: Forgot it / Hard / Good / Easy (or type 0–5 under Other).
4. `/learn`: show the roadmap and when each concept is next due.

State is kept in the plugin's own store across sessions.

## Develop

```
claude plugin validate --strict .
claude plugin test .
```

| File | Role |
| --- | --- |
| `hooks/register.ts` | Hooks: `session.start`, `command.run` (`/learn`), `tool.call` (spot concepts), `turn.complete` (explain + rate) |
| `hooks/sm2.ts` | Pure logic: SM-2, keyword matching, roadmap and rating parsing |
| `tests/` | `claude plugin test` suites |
