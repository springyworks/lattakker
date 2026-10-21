# Standing rules for AI coding assistants in this repository

1. **Show the result.** When your work is done, present it to the developer in the VS Code integrated browser: open or reload the running app (dev server http://127.0.0.1:5178/, the Lab is `#lab`) and go to the place that changed. Do this every time, before you finish.
2. **Avoid screenshots.** They are very expensive for the person who pays. Look with cheap means first (page text, the cell list, the DOM, tests). Take a screenshot only when the look itself is the question, and then only one.
3. **Experiment in a scratch place.** Try new things in the tab named "scratch" (create it if missing), or at most in the Lab. Never rework a cell that works (for example the ASR-33 terminal in the Lab) in place: commit or stash a working version first, and restore it if the experiment fails. Look in the code base before writing something new: it may already exist (check `git stash list` and the history).
4. Run `npm run typecheck` and `npm test`; both must pass when you are done.
