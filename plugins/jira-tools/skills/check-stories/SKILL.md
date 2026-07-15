---
name: check-stories
description: Audit user stories in a project for missing sprint assignment or missing "[...]" reference number in the title. Use when the user asks "/check-stories PROJ", "sprawdź user story", "które storisy nie mają sprintu albo numerka".
---

Audit user stories. Respond in the user's language. Arguments: $ARGUMENTS
Format: `<project> [sprint]` — project falls back to `defaultProject` from the config.

## Steps

1. Fetch stories via `search_issues`: `project = <PROJECT> AND issuetype = Story` (+ `AND sprint = "<sprint>"` when a sprint was given). Request the extra field `customfield` only if needed — the compact set plus a second query is usually enough.

2. Check each story for exactly two problems:
   - **Brak sprintu** — find them directly with a second query: `project = <PROJECT> AND issuetype = Story AND sprint is EMPTY` (skip this check when the user scoped the audit to one sprint).
   - **Brak numeru w tytule** — the title must contain a bracketed reference matching the regex `\[[^\]]+\]` (ANY content in square brackets counts; do NOT validate the number itself).

3. Output a table `KEY | problem` (one row per problem; a story can appear twice). End with a one-line count. If everything is clean, say so.
