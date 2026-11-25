---
name: project-rules
description: Save or show a project's shared rules, stored in Jira for the whole team - today "assignee → component" (e.g. "if a bug is assigned to Nowak or Kowalski add the Frontend component"), which jira-tools then applies automatically whenever it creates an issue or changes its assignee - ALWAYS with a preview and explicit user confirmation before saving. Use when the user says "/project-rules", "if a bug is assigned to X add component Y", "add X to the Backend rule", "X joined the team", "X left the team", "show the project rules", "which component does X get".
---

Manage the shared rules of a Jira project. Respond in the user's language. Request: $ARGUMENTS

The rules live in Jira (a project property), not in a local file: one save covers everyone who uses jira-tools on the project. `create_issue`, `create_issues`, `create_test_cases` and `update_issue` (assignee change) add the rule component in code. Rules only add a component — they never remove one.

## Hard rules

- **NEVER call `set_project_rules` without `dry_run` before the user confirms the preview.**
- `set_project_rules` REPLACES all component rules of the project. Always pass the FULL list: the current rules plus the change. Never drop a current rule unless the user asked for it.
- Do not guess a person. When the tool says a name matches several users or none, ask the user (AskUserQuestion with the candidates the tool listed).
- A refusal for missing permission (Administer Projects) → relay it and STOP. Only a project admin can save the rules.

## Steps

1. **Project**: the argument, else the project the user names, else `defaultProject` from `~/.config/jira-tools/config.json`. Ask when none is clear.
2. **Current rules**: `get_project_rules`. When the user only wants to see them, show them and stop.
3. **Map the request to rules** — one rule per component (and issue types):
   - "if a bug is assigned to A/B add the Frontend component" → `{component: "Frontend", assignees: ["A", "B"], issue_types: ["bug"]}`. A word for the issue type, in any language ("bug", "story", "task") → its role (`bug`, `story`, `task`, `epic`, `subtask`).
   - No issue type named → ask once: only bugs, or every issue type? (omit `issue_types` for every type).
   - "X joined the Backend team" → add X to the current Backend rule. "X left" → remove X from every rule. A full new set from the user → it replaces the current set; name the current rules that will go away.
   - People can be usernames or surnames — the tool resolves them.
4. **Preview**: `set_project_rules` with the full list and `dry_run: true`. Show the result and the difference from the current rules (rules and people added or removed). Problems (unknown component, ambiguous or unknown person, unknown type) → ask the user, fix, and run the dry run again.
5. **Confirm**: AskUserQuestion with a SHORT question that refers to the preview: save these rules for <PROJECT>?
6. **Save**: `set_project_rules` with the same list, without `dry_run`. Relay the result.
7. **Remind** in one line: the rules work when jira-tools creates an issue or changes its assignee. An assignment made by hand in Jira adds no component.
