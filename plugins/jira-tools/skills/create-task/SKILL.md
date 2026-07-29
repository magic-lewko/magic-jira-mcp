---
name: create-task
description: Create Jira tickets for a described case, one per platform (iOS/Android/Web/Backend), structuring what the USER provided into the project's template - ALWAYS with a dry-run preview and explicit user confirmation before anything is created. Use when the user says "/create-task", "create tasks for...", "create tickets for...", "create tickets for this case".
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
- **Create at most the previewed set** — one `create_issue` call per ticket, sequentially.
- **STOP immediately on the first creation error.** Report what was created and what was skipped; never blindly retry (on a retry check `search_issues` first).
- If a server refusal looks like a plugin bug (e.g. malformed-JQL/400), report it and stop — do NOT invent workarounds (renaming conventions, bypass flags) and do NOT persist such workarounds to memory.
- If a write is refused because the session budget is exhausted, relay it and STOP — do not restart the server or raise the limit without the user explicitly asking.

## Steps

1. **Scope**: project (argument or `defaultProject`), platforms from the profile's `platforms` (fallback: iOS, Android, Web, Backend) — which ones apply comes from the user; when unclear, ask. Map platforms to `components` from the profile; no matching component → create without one and say so. Issue type: ask when not obvious from the case (bug vs task vs story decides which template applies).

2. **Fill the template, not your imagination**: take `projects.<KEY>.taskTemplate.<type>` (when absent: a minimal Description + Acceptance criteria skeleton, written in the configured language) and map the user's words onto its sections. Mark every section the user did not cover.

3. **Interview round for the gaps** (skip only when nothing is missing): ask about ALL missing sections in one AskUserQuestion, quoting the section names from the template. Include **"who to assign it to (assignee)?"** in the same round (offer "unassigned" as an option — never guess a person). Fill in exactly what the user answers; unanswered sections get `(to be filled in)`, no assignee → leave unassigned.

4. **DRY-RUN (mandatory), two parts**:
   - Full preview as a normal chat message — one section per ticket:

     ```markdown
     ### 1/2 · [iOS] User logout
     Type: Task · Project: DC · Component: iOS · Assignee: jkowalski · Labels: — · Epic: — · Sprint: (per selection below)

     **Description (per project template):**
     …
     ```

   - Then AskUserQuestion with a SHORT question (never paste ticket contents into the dialog — it truncates; refer to the preview above): create or not, and sprint placement ("Active sprint «name» or backlog?").
   - Over **6 tickets** → extra warning with the exact count and a separate confirmation.

5. **Create** after confirmation: one `create_issue` per ticket, in order, with `sprint_id` when the user chose the sprint and `assignee` when the user named one. Report each returned key + URL. Server rails (per-project opt-in, duplicate guard, write budget) — relay refusals verbatim and STOP; never use `allow_duplicate` unless the user explicitly says the duplicate is intended.

6. **Link the set** (when more than one ticket was created, or the user pointed at a related story): ask whether to link them and how — default **"Relates"**, linking every new ticket to the story if given, otherwise to each other via the first one as hub. On yes, call `link_issues` (`from` = story/first ticket, `to` = the rest). Relay any refusal verbatim. Skip silently for a single unrelated ticket.

7. **Summary**: created keys with links + where they landed + how they were linked; list anything skipped. If any ticket has `(to be filled in)`, remind the user to fill it in.
