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
   - **Brak numeru w tytule** — the title must contain a NUMERIC bracketed reference matching
     `\[\d+\]` (an Azure work-item number, e.g. `[642321] Missing parameters in the event…`).
     Brackets with non-numeric content (`[F]`, `[iOS]`) do NOT count — report those separately
     as "nawias jest, ale bez numeru". Do NOT validate whether the number itself is correct.

   The audit also works on an explicit list of stories (e.g. release scope pasted from Notion):
   `issuekey in (PROJ-101, PROJ-105, ...)` instead of the project/sprint query.

3. Output a table `KEY | problem` (one row per problem; a story can appear twice). End with a one-line count. If everything is clean, say so.
