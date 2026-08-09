# Issue tracker: GitHub

Issues and specs for this repository live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- Create an issue with `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- Read an issue and its discussion with `gh issue view <number> --comments`, including labels when the workflow needs them.
- List issues with `gh issue list --state open --json number,title,body,labels,comments`, adding label and state filters as needed.
- Comment with `gh issue comment <number> --body "..."`.
- Apply or remove labels with `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close an issue with `gh issue close <number> --comment "..."`.

Infer the repository from `git remote -v`. The `gh` CLI does this automatically when run inside the clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repository treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, external PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- Read a PR with `gh pr view <number> --comments` and `gh pr diff <number>`.
- List external PRs with `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`, then keep only `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` author associations.
- Comment, label, or close with `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, or `gh pr close`.

GitHub shares one number space across issues and PRs. Resolve a bare `#42` with `gh pr view 42` and fall back to `gh issue view 42`.

## Skill vocabulary

When an engineering skill says to publish to the issue tracker, create a GitHub issue. When it says to fetch the relevant ticket, read the corresponding GitHub issue and its comments.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. Create it with `gh issue create --label wayfinder:map`.
- **Child ticket**: link an issue to the map as a GitHub sub-issue where supported. Otherwise add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Use `wayfinder:<type>` labels (`research`, `prototype`, `grilling`, or `task`). Once claimed, assign it to the driving developer.
- **Blocking**: prefer GitHub's native issue dependencies. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric database id. If dependencies are unavailable, use a `Blocked by: #<n>, #<n>` line at the top of the child body.
- **Frontier query**: list open map children, drop any with an open blocker or assignee, and take the first remaining ticket in map order.
- **Claim**: `gh issue edit <n> --add-assignee @me` is the session's first write.
- **Resolve**: comment the answer, close the ticket, then append a context pointer (gist plus link) to the map's Decisions-so-far section.
