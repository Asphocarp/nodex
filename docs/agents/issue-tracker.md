# Issue tracker: GitHub

Issues and PRDs for this repository live as GitHub issues. Use the `gh` CLI for issue operations.

## Conventions

- Create an issue with `gh issue create --title "..." --body "..."`.
- Read an issue and its discussion with `gh issue view <number> --comments`.
- List issues with `gh issue list`, requesting JSON fields when a workflow needs structured data.
- Comment with `gh issue comment <number> --body "..."`.
- Apply or remove labels with `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close an issue with `gh issue close <number> --comment "..."`.

Infer the repository from the configured Git remote. The `gh` CLI does this automatically when run inside the clone.

## Skill vocabulary

When an engineering skill says to publish to the issue tracker, create a GitHub issue. When it says to fetch the relevant ticket, read the corresponding GitHub issue and its comments.
