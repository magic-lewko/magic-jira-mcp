---
name: get-tasks
description: List the current user's Jira tasks in a project, optionally narrowed to a sprint and/or labels. Use when the user asks "moje taski", "my tasks", "co mam do zrobienia w PROJ", "/get-tasks PROJ Sprint 12 tags:frontend,urgent" or similar.
---

Show the user their tasks. Respond in the user's language. Arguments: $ARGUMENTS
Format: `<project> [sprint] [tags:a,b,c]` — project falls back to `defaultProject` from `~/.config/jira-tools/config.json`.

## Steps

1. Build JQL and call the `search_issues` MCP tool (server `jira`):
   - Base: `project = <PROJECT> AND assignee = currentUser()`
   - Sprint given by name: `AND sprint = "<name>"`; the words "current"/"aktualny" → `AND sprint in openSprints()`
   - Tags: `AND labels in (a, b, c)`
   - Order: `ORDER BY status, priority DESC`

2. Present the result grouped by status (order from the project profile in the config, if present), keeping it compact: key, title, priority, labels. If the tool reports truncation, say so and offer to narrow the query.

3. If the result is empty, say so explicitly and offer the unfiltered variant (without sprint/tags).
