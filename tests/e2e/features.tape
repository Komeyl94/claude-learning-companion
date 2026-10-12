# End-to-end check in a real terminal: every feature, one screenshot per step.
#
#   rm -f ~/.claude/plugins/store/learning-companion_inline-*.json
#   vhs tests/e2e/features.tape        # from the repository root, about 5 minutes
#   git checkout -- demo/project
#
# Then look at tests/e2e/out/*.png: roadmap, permission, lesson, example, quiz,
# quiz_result, rating, rated, progress, tutor, learn, learn_rated. It calls the
# real model through your Claude Code login. A step that times out fails the run.

Output tests/e2e/out/features.gif

Set Shell "bash"
Set FontSize 15
Set Width 1400
Set Height 900
Set Theme "Catppuccin Mocha"
Set TypingSpeed 20ms

Hide
Type "for v in $(env | grep -o '^CLAUDE[A-Z_]*'); do unset $v; done; cd demo/project && clear && claude --plugin-dir ../.. --setting-sources project,local --strict-mcp-config --permission-mode acceptEdits" Enter
Wait+Screen@30s /accept edits/
Show

Type "/roadmap Laravel backend" Sleep 500ms Enter
Wait+Screen@180s /Keep coding/
Sleep 1s
Screenshot tests/e2e/out/roadmap.png
Sleep 1s

Type "Add a GET /users route to routes/web.php that returns all users as JSON" Sleep 500ms Enter
Wait+Screen@180s /Do you want to/
Sleep 1s
Screenshot tests/e2e/out/permission.png
Sleep 1s
Enter
Wait+Screen@300s /What next/
Sleep 1s
Screenshot tests/e2e/out/lesson.png
Sleep 1s

Enter
Sleep 20s
Screenshot tests/e2e/out/example.png
Sleep 1s

Down Down Sleep 500ms Enter
Sleep 20s
Screenshot tests/e2e/out/quiz.png
Sleep 1s

Enter
Sleep 12s
Screenshot tests/e2e/out/quiz_result.png
Sleep 1s

Down Down Down Sleep 500ms Enter
Wait+Screen@60s /How well do you understand/
Sleep 1s
Screenshot tests/e2e/out/rating.png
Sleep 1s

Enter
Sleep 5s
Screenshot tests/e2e/out/rated.png
Sleep 1s

Type "/progress" Sleep 500ms Enter
Wait+Screen@30s /Stage 1/
Sleep 2s
Screenshot tests/e2e/out/progress.png
Sleep 1s

Type "/tutor why return JSON instead of a Blade view here?" Sleep 500ms Enter
Sleep 40s
Screenshot tests/e2e/out/tutor.png
Sleep 1s

Type "/learn" Sleep 500ms Enter
Wait+Screen@120s /What next/
Sleep 1s
Screenshot tests/e2e/out/learn.png
Sleep 1s
Down Down Down Sleep 500ms Enter
Wait+Screen@60s /How well do you understand/
Sleep 2s
Enter
Sleep 5s
Screenshot tests/e2e/out/learn_rated.png
Sleep 1s
