---
name: create-task
description: Create Jira tickets for a described case, one per platform (iOS/Android/Web/Backend), with generated description and acceptance criteria - ALWAYS with a dry-run preview and explicit user confirmation before anything is created. Use when the user says "/create-task", "załóż taski na...", "utwórz tickety dla...", "create tickets for this case".
---

Create per-platform tickets for the case described in: $ARGUMENTS
Respond in the user's language. Generated ticket content (description, acceptance criteria) follows the `language` from `~/.config/jira-tools/config.json`.

## Hard safety rules — no exceptions

- **NEVER call `create_issue` before the user explicitly confirms the dry-run preview.**
- **Create at most the previewed set** — one `create_issue` call per ticket, sequentially.
- **STOP immediately on the first creation error.** Report what was created and what was skipped. Never blindly retry — on a retry, first verify with `search_issues` which tickets already exist.
- If the write tools are not available, writes are disabled (`allowWrite: false`) — tell the user to set `"allowWrite": true` in the config and `/reload-plugins`; do not look for workarounds.

## Steps

1. **Scope**: determine target project (argument or `defaultProject` from config) and platforms. Platforms come from the case description; when unclear, ask. Map platforms to component names from the project profile (`projects.<KEY>.components` in the config) — when the project has no matching components, create without a component and mention it.

2. **Generate ticket content** per platform:
   - Title: `[<Platform>] <concise case title>` (e.g. `[iOS] Logout flow`).
   - Description: short context of the case + link/reference the user provided, in the configured language.
   - Acceptance criteria: 3-6 testable bullet points, in the configured language.
   - Type: `Task` unless the user says otherwise; labels only when the user asked for them; `epic_key` when the user pointed at an epic.

3. **DRY-RUN (mandatory)**: present ALL planned tickets in full (title, type, component, labels, epic, complete description + AC). Then ask for confirmation with AskUserQuestion:
   - options: create all / edit something / cancel;
   - when the plan exceeds **6 tickets**, add an explicit warning with the exact count and require a separate confirmation.

4. **Create** only after confirmation: one `create_issue` per ticket, in order. After each, report the returned key + URL. The server enforces its own rails (duplicate guard, session write budget) — when it refuses, relay the reason verbatim and STOP; do not bypass with `allow_duplicate` unless the user explicitly says the duplicate is intended.

5. **Summary**: list created keys with links; suggest verifying on the board. If anything was skipped, list it clearly.
