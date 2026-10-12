# Records docs/demo.gif and the README screenshots in docs/.
#
#   1. Install vhs: https://github.com/charmbracelet/vhs#installation
#   2. From the repository root:
#        rm -f ~/.claude/plugins/store/learning-companion_inline-*.json
#        vhs demo/demo.tape
#        git checkout -- demo/project
#
# Claude Code runs with this checkout as a plugin (--plugin-dir), which keeps
# its own store, so an installed copy's roadmaps are not touched. User
# settings and MCP servers are left out so the recording shows this plugin
# alone. Model waits are hidden, so the GIF shows each step without the pause.

Output docs/demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 1280
Set Height 800
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms

Hide
Type "for v in $(env | grep -o '^CLAUDE[A-Z_]*'); do unset $v; done; cd demo/project && clear && claude --plugin-dir ../.. --setting-sources project,local --strict-mcp-config --permission-mode acceptEdits" Enter
Wait+Screen@30s /accept edits/
Show
Sleep 1s

# A roadmap for a goal
Type "/roadmap Laravel backend" Sleep 600ms Enter
Hide
Wait+Screen@300s /Keep coding/
Show
Sleep 4s

# Claude writes code that uses a concept; the lesson follows the turn
Type "Add a GET /users route to routes/web.php that returns all users as JSON" Sleep 600ms Enter
Hide
Wait+Screen@180s /Do you want to/
Show
Sleep 1500ms
Enter
Hide
Wait+Screen@300s /What next/
Show
Sleep 5s
Screenshot docs/lesson.png
Sleep 1s

# Quiz me
Down Sleep 400ms Down Sleep 400ms Enter
Hide
Sleep 25s
Show
Sleep 4s
Screenshot docs/quiz.png
Sleep 1s
Enter
Hide
Wait+Screen@60s /What next/
Show
Sleep 4s

# Rate it: the quiz result is offered first
Down Sleep 400ms Down Sleep 400ms Down Sleep 400ms Enter
Hide
Wait+Screen@60s /How well do you understand/
Show
Sleep 4s
Screenshot docs/rating.png
Sleep 1s
Enter
Sleep 4s

# Progress by stage
Type "/progress" Sleep 600ms Enter
Hide
Wait+Screen@30s /Stage 1/
Show
Sleep 5s
Screenshot docs/progress.png
Sleep 1s

# A side question about the session
Type "/tutor why return JSON instead of a Blade view here?" Sleep 600ms Enter
Hide
Sleep 40s
Show
Sleep 6s
Screenshot docs/tutor.png
Sleep 1s
