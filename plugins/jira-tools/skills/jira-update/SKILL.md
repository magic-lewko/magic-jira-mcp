---
name: jira-update
description: Reconcile the jira-tools config after a plugin update — keeps your Jira server URL and token, removes obsolete/unknown fields left over from older versions, and refreshes project profiles to the current schema. Use after updating the plugin or when the config feels stale/broken. Triggers "/jira-update", "update the jira config", "fix the jira config after an update", "clean up the jira config".
---

Bring an existing `~/.config/jira-tools/config.json` up to the current schema WITHOUT making the user re-enter their credentials. Respond in the user's language. Never print the token.

## Rules

- **Never touch `server` and `token`** — carry them over verbatim. This is the whole point: the user should not re-generate a PAT or retype the URL.
- **Back up first**: copy the file to `config.json.bak` next to it before writing.
- If there is no config file → this is a first-time setup, not an update: tell the user to run `/jira-tools:jira-setup` and stop.

## Current schema (anything else is obsolete → remove)

Top level: `server`, `token`, `language`, `defaultProject`, `projects`, `writeBudget`.
Per project (`projects.<KEY>`): `boardId`, `boardName`, `statuses`, `epicLinkField`,
`sprintField`, `platforms`, `titleConvention`, `taskTemplate`, `components`, `issueTypes`.

Known OBSOLETE fields to strip (from older versions): top-level `allowWrite`, `aiLabel`,
`writeProjects`; per-project `allowWrite`. Strip anything not in the schema above.

## Steps

1. **Read** the current config. Keep `server`, `token`, `language`, `defaultProject` as-is.

2. **Clean** — remove every field not in the current schema (top level and inside each
   project profile). Collect the list of what you removed to show the user.

3. **Refresh each project profile** — for every key in `projects`, call `get_project_config`
   (server `jira`) with that key and merge the returned fields (board, statuses, epic/sprint
   field, components, issue types). **Preserve** user-authored fields that the tool does not
   return — `platforms`, `titleConvention`, `taskTemplate` — do not drop them. If a project
   profile turns out to be for a project that no longer exists (404), ask the user whether to
   drop it.

4. **Verify** the connection with `get_current_user`. On 401 → the saved token expired; tell
   the user to run `/jira-tools:jira-setup` to set a fresh one (do not wipe the rest).

5. **Write** the cleaned config (after the backup). Show a short summary:
   - kept: server, token (do not show the value), language, default project,
   - removed: <list of obsolete fields>,
   - refreshed: <which project profiles>,
   - anything you were unsure about and left as-is.
