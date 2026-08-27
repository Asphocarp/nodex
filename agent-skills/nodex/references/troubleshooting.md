# Troubleshooting

## `nodex` is not found

Nodex operations require a local CLI and desktop/Core runtime. Ask the user to
install or open Nodex and ensure `nodex` is on the Agent process `PATH`. Do not
download a replacement binary, inspect application storage, or edit Agent
configuration.

## Agent API revision is incompatible

This Skill requires Agent API revision 1. If
`nodex capabilities --json` does not include revision 1 in its supported range,
stop and ask the user to update Nodex or use a Skill version compatible with
their installed app. Never guess renamed commands.

## Core or Profile is unavailable

Ask the user to open the local Nodex desktop app and confirm the intended
Profile. A cloud-only or remote Agent session cannot access a user's local
Nodex Core unless the CLI is actually running on that same machine.

## Project is missing or ambiguous

Run `nodex context --json` from the intended managed worktree or ask the user
which Project to use. Pass the exact choice with `--project @PROJECT_ID` when
available. Do not choose a candidate by list order and do not search another
Project to work around authorization.

## ETag or cursor is stale

ETags and cursors are scoped validators, not durable IDs. Reread the Page or
saved View and reconsider the mutation against current state. Do not strip the
validator, retry an old ETag, or substitute another command's ETag.

## A Page File manifest changed

Rerun `nodex page file list --json @PAGE_ID`, compare the current File identity,
path, and version with the requested change, then issue a new logical mutation
with a new idempotency key. Reuse the prior key only when the prior response was
lost and the payload is identical. If deletion reports that the File is in use,
remove the intended Page-body placements first; do not bypass the reference
guard.

## The Skill is externally managed

A project-local or copied Skill may be managed by an external Skills installer.
Do not overwrite, relink, remove, or repair it. Explain the detected state and
let the user manage it with the installer that created it.

## A target is missing or deleted

Fail closed. Rediscover the resource within the selected Project. Do not use
raw storage, deleted rows, deep-link location lookup, or another Project as a
fallback.
