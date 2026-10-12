# Changelog

All notable changes to Learning Companion. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

To update an installed copy:

```bash
claude plugin marketplace update learning-companion
claude plugin update learning-companion@learning-companion
```

## [2.3.0] - 2026-10-12

### Changed

- Every command is now also `/companion-<name>`: `/companion-roadmap`, `/companion-learn`,
  `/companion-practice`, `/companion-progress` and `/companion-tutor`. Messages point to these names.
- The short names (`/learn`, `/practice`, ...) still work, but only while no other command or skill has
  that name. Before, `/learn` clashed with the `learn` skill in the Claude Desktop app.

## [2.2.0] - 2026-10-12

### Added

- `/learn [#|name]` teaches the next concept you have not started, without waiting for it to come up in code.
- `/practice [#|name]` goes through every concept due for review, one lesson after another.
- Lesson notes: each lesson is saved as Markdown in `~/learning-notes/<roadmap>/<concept>.md`.
- Settings in `/config`: lesson model (`haiku`, `sonnet`, `opus`), automatic lessons on or off, a daily cap on
  automatic lessons (default 5), and the notes folder (empty turns notes off).
- A daily streak and the number of due reviews on the status line.
- `/roadmap export <#|name> [anki]` writes a roadmap to share (JSON, without progress) or Anki cards.
  `/roadmap import <file>` adds a shared roadmap, or merges it into yours for the same goal.
- `/roadmap` reads your project's dependency manifest (`package.json`, `composer.json`, `pyproject.toml`
  and others), so keywords match the libraries you use.
- After a quiz, its result suggests the rating and is offered first.
- A demo GIF and screenshots in the README, recorded with [vhs](https://github.com/charmbracelet/vhs).
- GitHub Actions runs validation and tests on every push; evals grade roadmap and tutor quality.

### Changed

- Generic keywords (`get`, `config`) and file names or paths (`.env`, `config/`) are dropped from roadmaps.
- Without a quiz, "Good" is offered first in the rating, so Enter alone never rates "Forgot it".
- Quiz options are shuffled, since models tend to list the right answer first.
- A lesson step reaches the transcript once its dialog closes, instead of showing twice.
- A closed lesson points to `/tutor` to keep talking it through.

### Fixed

- Multi-line lesson steps showed "�" in the transcript.
- Markdown headings, bold markers and code fences that the model added anyway showed up raw.

### Privacy

- Lesson notes stay on disk and can quote the (redacted) code a lesson was about. Clear the notes folder
  setting to turn them off.

## [2.1.0] - 2026-10-12

### Added

- Roadmaps of 12–20 concepts in 3–6 ordered stages, instead of 5 concepts.
- Lessons after the explanation: **Show an example**, **Go deeper**, **Quiz me** (multiple choice), or type
  your own question, then **Rate it**.
- `/tutor <question>` answers a side question over the current session, like `/btw`, even mid-turn.
- `/progress [#|name]` shows every roadmap by stage: mastered, learning, due, not started.
- Several roadmaps at once. `/roadmap` lists them; `/roadmap update <#|name>` regenerates one and keeps your
  progress; `/roadmap remove <#|name>` deletes one after you confirm.
- MIT license file.

### Changed

- `/roadmap` with no goal lists your roadmaps instead of showing one.
- A 2.0 roadmap is upgraded on load. Run `/roadmap update 1` to grow it while keeping your review history.

## [2.0.0] - 2026-10-11

Rebuilt as a function-hook plugin (mod). Needs Claude Code 2.1.288 or later; no API key.

### Added

- `/roadmap <goal>` builds a roadmap of concepts with keywords to spot in code.
- Concepts are spotted in what Claude writes or runs; at the end of the turn you get a short explanation tied
  to that code and rate it.
- Reviews are scheduled with SM-2 spaced repetition.
- Writes to secret files (`.env*`, keys, credentials) are skipped, and secret-looking values in kept snippets
  are replaced with `[REDACTED]`.

[2.3.0]: https://github.com/Komeyl94/claude-learning-companion/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/Komeyl94/claude-learning-companion/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/Komeyl94/claude-learning-companion/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/Komeyl94/claude-learning-companion/releases/tag/v2.0.0
