---
name: jira-config
description: Fetch and save a per-project profile (board, status columns in order, components, issue types with their roles, Epic Link / Epic Name / Story Points fields) into the user's jira-tools config. Use when the user says "/jira-config PROJ", "configure project", "fetch the board configuration", or when sprint/epic tools need status names for an unprofiled project.
---

Build a project profile so the other Jira skills stop guessing status names. Respond in the user's language. Project key comes from the arguments: $ARGUMENTS

## Steps

1. If no project key was given, ask for it (or use `defaultProject` from `~/.config/jira-tools/config.json` if set — confirm with the user).

2. Call the `get_project_config` MCP tool (server `jira`) with the project key.
   - If it reports several boards, show the list, ask the user which board is the default one for their work, then call the tool again with the chosen `board_id`.

3. The tool returns a ready JSON profile. **Merge** it into `~/.config/jira-tools/config.json` under `projects.<PROJECTKEY>` (uppercase key):
   - Read the current file, deep-merge (existing keys the tool did not return must survive), write back.
   - Never touch `server`/`token` values while editing.

4. **Ask about team conventions for this board** (skip when the profile already has them,
   unless the user wants to change them):
   - Issue type roles — the tool proposes `issueTypeRoles` (epic/story/task/subtask/bug →
     the project's own type names, detected by name and by Jira's sub-task flag). Show the
     proposal next to the project's full type list and ask the user to confirm or complete
     it. Localised instances need this map so `/jira-tools:create-task` can address types by
     role. Save as `"issueTypeRoles": { "epic": "...", "story": "...", "subtask": "...", ... }`.
   - Platforms used in this project — propose the default `iOS, Android, Web, Backend`
     and let the user adjust (some boards have only Web, some add e.g. Analytics).
   - Task title convention for per-platform tickets — propose `[<Platform>] <title>`
     (e.g. `[iOS] User logout`) and let the user pick their own pattern.

   Save the answers in the profile as `"platforms": [...]` and `"titleConvention": "..."` —
   `/jira-tools:create-task` reads them instead of assuming defaults.

   Also set up **description templates per issue TYPE** (`taskTemplate.{bug,story,task}`).
   Offer three ways, in this order:

   1. **Import from an existing ticket (recommended)** — the user points at reference tickets in
      Jira that are written the way the team wants, one per type, e.g.
      `BUG - DC-99, TASK - DC-100, STORY - DC-101`. For each: call `get_issue`, read the
      description, and derive a template from its STRUCTURE — keep the section headers,
      ordering, formatting and wording style; replace the concrete content of each section
      with a short placeholder. Show the derived template and ask for acceptance.
      This gives a template in the team's real style instead of a generic one.
   2. **Custom template** — the user pastes the sections directly.
   3. **Skill suggestion** — only when the user asks for a suggestion (phrase the section
      headers in the configured language):
      bug: Problem / Reproduction steps / Expected / Environment;
      story: Business context / Scope / Acceptance criteria;
      task: Context / Scope / Definition of Done.

   Types not covered stay without a template (that's fine). Save as
   `"taskTemplate": { "bug": "...", "story": "...", "task": "..." }`.

   Tell the user what the template is FOR: it makes `/jira-tools:create-task` ask them for
   the sections they skipped, instead of inventing content. The agent fills sections only
   with what the user provides.

5. Show the user a short summary of what was saved: board, status column order, Epic Link / Epic Name / Story Points fields, issue type roles, component count, platforms + title convention. Mention that `/jira-tools:sprint-health` and epic queries will now use these statuses, and that `/jira-tools:create-task` will address issue types by role.
