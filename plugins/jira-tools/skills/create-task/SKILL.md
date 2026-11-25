---
name: create-task
description: Create Jira tickets for a described case - one per platform (iOS/Android/Web/Backend) or a whole breakdown (epic, stories, sub-tasks) - structuring what the USER provided into the project's template, ALWAYS with a dry-run preview and explicit user confirmation before anything is created. Use when the user says "/create-task", "create tasks for...", "create tickets for...", "create tickets for this case", "create the breakdown in Jira", "add a task", "add a bug", "report a bug".
---

Turn the user's case into Jira tickets. Respond in the user's language; ticket content follows the `language` from `~/.config/jira-tools/config.json`. Case: $ARGUMENTS

## GOLDEN RULE — do not invent content on the user's behalf

Your job is to **structure what the user said and ask about the gaps** — NOT to fill the ticket with your own inventions.

- **Never make up** acceptance criteria, reproduction steps, environment, scope, or a "nicer" description of the problem. If the user didn't say something — you don't know it.
- A template section with no data from the user = **a signal to ask**, not to fill it in. The template exists to force the user to think.
- Ask one round of questions about the gaps, directly and specifically, e.g.: "The bug template has an *Acceptance criteria* section — you didn't provide it. How will we know it's fixed?", "In what environment does this occur?".
- You may **gently push** ("without reproduction steps the dev will be guessing — do you have at least one example?"), but when the user deliberately skips a section, insert the literal `(to be filled in)` and leave it.
- You may: rephrase the user's sentences into a concise description, split one case into platforms, choose a title per the convention. You may not: add substantive content that wasn't there.

## Hard safety rules — no exceptions

- **NEVER call `create_issue` before the user explicitly confirms the dry-run preview** — even when they say "without asking".
- **Create at most the previewed set** — a single ticket via `create_issue`; a set via ONE `create_issues` call with exactly the previewed items (max 50 per call). Parents before children: the epic, then the stories, then the sub-tasks in a second call with `parent` set to the keys Jira just returned.
- **STOP on a creation error.** A bulk call reports per-item results — relay what was created and what failed; never blindly retry (on a retry check `search_issues` first).
- If a server refusal looks like a plugin bug (e.g. malformed-JQL/400), report it and stop — do NOT invent workarounds (renaming conventions, bypass flags) and do NOT persist such workarounds to memory.
- If a write is refused because the session budget is exhausted, relay it and STOP — do not restart the server or raise the limit without the user explicitly asking.
- **Always ask: active sprint or backlog?** Never choose for the user. The server refuses a ticket (except an epic or a sub-task) without `sprint_id` or `backlog: true`.
- **A bug uses the standard bug template** unless the user explicitly asks for another one. The server refuses a bug without it.

## Steps

1. **Scope**: project (argument or `defaultProject`), platforms from the profile's `platforms` (fallback: iOS, Android, Web, Backend) — which ones apply comes from the user; when unclear, ask. Map platforms to `components` from the profile; no matching component → create without one and say so. Issue type: ask when not obvious from the case (bug vs task vs story decides which template applies). Pass it as a ROLE — `epic`, `story`, `task`, `subtask` or `bug` — the tool resolves it to the project's own type name through the profile's `issueTypeRoles` (localised instances included). A `subtask` needs a `parent`; an `epic` gets `epic_name` (defaults to the title).

2. **Fill the template, not your imagination**:
   - **Bug → the standard bug template** (the team standard; do not ask which template to use):

     ```
     [label] title

     **Steps to reproduce:**
     1. …

     **Actual result:**
     …

     **Expected result:**
     …
     ```

     The title is `[<label>] <title>`: the label is the platform or area the user named, e.g. `[Web] Save button does nothing`. Map the user's words to `steps_to_reproduce` (one step per item), `actual_result` and `expected_result`. The server writes the description in exactly this layout (bold headers, a blank line before each). Anything else the user gave (environment, logs, links) goes to `description` — it lands below the template. Use another template ONLY when the user asks for it: then the profile's `taskTemplate.bug` or the user's own text as `description`, with `custom_template: true`.
   - **Other types**: take `projects.<KEY>.taskTemplate.<type>` (when absent: a minimal Description + Acceptance criteria skeleton, written in the configured language) and map the user's words onto its sections. Write the description in Markdown (headings, lists, tables, checklists) — the tool converts it to Jira wiki markup so it renders properly.
   - Mark every section the user did not cover.

3. **Interview round for the gaps** (skip only when nothing is missing): ask about ALL missing sections in one AskUserQuestion, quoting the section names from the template (for a bug: the label, Steps to reproduce, Actual result, Expected result). Include **"who to assign it to (assignee)?"** in the same round (offer "unassigned" as an option — never guess a person). Fill in exactly what the user answers; unanswered sections get `(to be filled in)`, no assignee → leave unassigned. When a ticket has an assignee, call `get_project_rules` once for the project: a matching rule adds its component in code, so show it in the preview as `Component: Frontend (project rule)` — no need to pass it yourself.

4. **DRY-RUN (mandatory), two parts**:
   - Before the preview, get the active sprint: `get_active_sprint` with the profile's `boardId` (no profile → `list_boards` for the project; several boards → ask which one). No active sprint → say so; the tickets go to the backlog.
   - Full preview as a normal chat message — one section per ticket:

     ```markdown
     ### 1/2 · [iOS] User logout
     Type: Task · Project: DC · Component: iOS · Assignee: jkowalski · Labels: — · Epic: — · Parent: — · Story Points: — · Sprint: (per selection below)

     **Description (per project template):**
     …
     ```

     For a bug, write `Template: standard bug` in the type line and show the three sections as the server will write them.
   - Then ONE AskUserQuestion with two SHORT questions (never paste ticket contents into the dialog — it truncates; refer to the preview above): (1) create or not; (2) **"Add to the active sprint «name» or to the backlog?"** — always ask it, even when the user did not mention a sprint. Skip (2) only when every ticket is an epic or a sub-task (a sub-task follows its parent) or when there is no active sprint.
   - Over **6 tickets** → extra warning with the exact count and a separate confirmation.

5. **Create** after confirmation, in dependency order: (a) the epic, if any, via `create_issue`; (b) the stories/tasks via ONE `create_issues` call with `epic_key` set to the epic's key; (c) the sub-tasks via a second `create_issues` call with `parent` set to the story keys Jira just returned. Pass `sprint_id` when the user chose the sprint, `backlog: true` when they chose the backlog (on every ticket except epics and sub-tasks), `assignee` when the user named one, `story_points` when given. Report every returned key + URL and every per-item error. Server rails — the duplicate guard (scoped to the parent for sub-tasks) and the write budget (the whole batch must fit or nothing is created) — relay refusals verbatim and STOP; never use `allow_duplicate` unless the user explicitly says the duplicate is intended. Over 50 items, split into calls of at most 50.

6. **Link the set** (when more than one ticket was created, or the user pointed at a related story): ask whether to link them and how — default **"Relates"**, linking every new ticket to the story if given, otherwise to each other via the first one as hub. On yes, call `link_issues` (`from` = story/first ticket, `to` = the rest). Relay any refusal verbatim. Skip silently for a single unrelated ticket.

7. **Summary**: created keys with links + where they landed + how they were linked; list anything skipped. If any ticket has `(to be filled in)`, remind the user to fill it in.
