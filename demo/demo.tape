# Records demo/demo.gif for the README.
#
#   1. Install vhs: https://github.com/charmbracelet/vhs#installation
#   2. From the repository root: vhs demo/demo.tape
#
# It runs Claude Code with this checkout as a plugin (--plugin-dir), which keeps
# its own store: your installed plugin's roadmaps are not touched. Model replies
# vary in length, so adjust a Sleep if a step is cut short.

Output demo/demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 1300
Set Height 820
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "cd demo/project && claude --plugin-dir ../.." Enter
Sleep 6s
Show

# 1. A roadmap for a goal
Type "/roadmap Laravel backend" Sleep 500ms Enter
Sleep 45s

# 2. Claude writes code that uses a concept: a lesson follows the turn
Type "Add a GET /users route to routes/web.php that returns all users as JSON" Sleep 500ms Enter
Sleep 40s

# 3. Lesson menu: Show an example
Sleep 4s
Enter
Sleep 12s

# 4. Quiz me (third option), then pick the first answer
Down Down Sleep 1s Enter
Sleep 12s
Enter
Sleep 8s

# 5. Rate it (fourth option), then take the suggested rating
Down Down Down Sleep 1s Enter
Sleep 3s
Enter
Sleep 4s

# 6. Progress
Type "/progress" Sleep 500ms Enter
Sleep 6s

# 7. A side question
Type "/tutor why return a JSON response instead of a view here?" Sleep 500ms Enter
Sleep 20s

Hide
Ctrl+C Ctrl+C
