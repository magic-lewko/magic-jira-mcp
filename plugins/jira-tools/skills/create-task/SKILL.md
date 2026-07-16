---
name: create-task
description: Create Jira tickets for a described case, one per platform (iOS/Android/Web/Backend), with generated description and acceptance criteria - ALWAYS with a dry-run preview and explicit user confirmation before anything is created. Use when the user says "/create-task", "załóż taski na...", "utwórz tickety dla...", "create tickets for this case".
---

Create per-platform tickets for the case described in: $ARGUMENTS
Respond in the user's language. Generated ticket content (description, acceptance criteria) follows the `language` from `~/.config/jira-tools/config.json`.

## Hard safety rules — no exceptions

- **NEVER call `create_issue` before the user explicitly confirms the dry-run preview.** This also applies when the user says "bez pytania" — the preview + confirmation always happen.
- **Create at most the previewed set** — one `create_issue` call per ticket, sequentially.
- **STOP immediately on the first creation error.** Report what was created and what was skipped. Never blindly retry — on a retry, first verify with `search_issues` which tickets already exist.
- If a server refusal looks like a plugin bug (e.g. a malformed-JQL/400 error), report it to the user and stop — do NOT invent workarounds (renaming conventions, bypass flags) and do NOT persist such workarounds to memory. Bugs belong to the plugin repo, not to your habits.
- If the write tools are not available, writes are disabled (`allowWrite: false`) — tell the user to set `"allowWrite": true` in the config and `/reload-plugins`; do not look for workarounds.

## Steps

1. **Scope**: determine target project (argument or `defaultProject` from config) and platforms. The available platform set comes from the project profile (`projects.<KEY>.platforms`; fallback: iOS, Android, Web, Backend) — which of them apply comes from the case description; when unclear, ask. Map platforms to component names from the project profile (`projects.<KEY>.components`) — when the project has no matching components, create without a component and mention it.

2. **Sprint**: check the project profile for `boardId`; if present, call `get_active_sprint`. The sprint question becomes part of the confirmation (step 4) — tickets go to the active sprint only when the user picks it; default is backlog.

3. **Generate ticket content** per platform:
   - Title: follow the project profile's `titleConvention` (fallback: `[<Platform>] <concise case title>`, e.g. `[iOS] Logout flow`).
   - Description: short context of the case + link/reference the user provided, in the configured language.
   - Acceptance criteria: 3-6 testable bullet points, in the configured language.
   - Type: `Task` unless the user says otherwise; labels only when the user asked for them; `epic_key` when the user pointed at an epic.

4. **DRY-RUN (mandatory), in two parts**:
   - First print the FULL preview **as a normal chat message**, clearly formatted — one section per ticket:

     ```markdown
     ### 1/2 · [iOS] Wylogowanie użytkownika
     Typ: Task · Projekt: DC · Komponent: iOS · Labels: — · Epic: — · Sprint: (wg wyboru niżej)

     **Opis:** …

     **Kryteria akceptacji:**
     - …
     ```

   - Then ask with AskUserQuestion. The question text must stay SHORT — never paste ticket contents into the dialog (it truncates); refer to the preview above. Ask two things: create or not ("Utworzyć N ticketów zgodnie z podglądem powyżej?" — options: create all / edit / cancel) and sprint placement ("Aktywny sprint «name» czy backlog?").
   - When the plan exceeds **6 tickets**, add an explicit warning with the exact count and require a separate confirmation.

5. **Create** only after confirmation: one `create_issue` per ticket, in order, passing `sprint_id` when the user chose the active sprint. After each, report the returned key + URL. The server enforces its own rails (per-project opt-in, duplicate guard, session write budget) — when it refuses, relay the reason verbatim and STOP; do not bypass with `allow_duplicate` unless the user explicitly says the duplicate is intended.

6. **Summary**: list created keys with links + where they landed (sprint/backlog); suggest verifying on the board. If anything was skipped, list it clearly.
