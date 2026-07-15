---
name: jira-config
description: Fetch and save a per-project profile (board, status columns in order, components, issue types, Epic Link field) into the user's jira-tools config. Use when the user says "/jira-config PROJ", "skonfiguruj projekt", "pobierz konfigurację tablicy/boardu", or when sprint/epic tools need status names for an unprofiled project.
---

Build a project profile so the other Jira skills stop guessing status names. Respond in the user's language. Project key comes from the arguments: $ARGUMENTS

## Steps

1. If no project key was given, ask for it (or use `defaultProject` from `~/.config/jira-tools/config.json` if set — confirm with the user).

2. Call the `get_project_config` MCP tool (server `jira`) with the project key.
   - If it reports several boards, show the list, ask the user which board is the default one for their work, then call the tool again with the chosen `board_id`.

3. The tool returns a ready JSON profile. **Merge** it into `~/.config/jira-tools/config.json` under `projects.<PROJECTKEY>` (uppercase key):
   - Read the current file, deep-merge (existing keys the tool did not return must survive), write back.
   - Never touch `server`/`token` values while editing.

4. Show the user a short summary of what was saved: board, status column order, epic link field, component count. Mention that `/jira-tools:sprint-health` and epic queries will now use these statuses.
