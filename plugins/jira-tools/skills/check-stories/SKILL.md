---
name: check-stories
description: Audit user stories in a project for missing sprint assignment or missing "[...]" reference number in the title. Use when the user asks "/check-stories PROJ", "check the user stories", "which stories are missing a sprint or a reference number".
---

Audit user stories. Respond in the user's language. Arguments: $ARGUMENTS
Format: `<project> [sprint]` — project falls back to `defaultProject` from the config.

## Steps

1. Fetch stories via `search_issues`: `project = <PROJECT> AND issuetype = Story` (+ `AND sprint = "<sprint>"` when a sprint was given). Request the extra field `customfield` only if needed — the compact set plus a second query is usually enough.

2. Check each story for exactly two problems:
   - **Missing sprint** — find them directly with a second query: `project = <PROJECT> AND issuetype = Story AND sprint is EMPTY` (skip this check when the user scoped the audit to one sprint).
   - **Missing number in the title** — the title must contain an Azure work-item reference matching
     `\[\d{6,}\]` (6+ digits, e.g. `[642321] Missing parameters in the event…`); when the
     project profile defines `storyNumberPattern`, use that regex instead. Brackets that do
     NOT match — `[F]`, `[iOS]`, `[2024]`, `[42]` — do not count; report them separately as
     "there is a bracket, but it is not a ticket number". Do NOT validate whether the number
     itself exists in Azure.

   The audit also works on an explicit list of stories (e.g. release scope pasted from Notion):
   `issuekey in (PROJ-101, PROJ-105, ...)` instead of the project/sprint query.

3. Output a table `KEY | problem` (one row per problem; a story can appear twice). End with a one-line count. If everything is clean, say so.
