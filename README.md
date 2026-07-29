# jira-claude-plugin

Talk to Jira in plain language through Claude — sprint reports, finding bugs by
description, creating and editing tickets. One MCP server works in both Claude
Desktop and Claude Code.

16 tools · 8 skills. Full examples: [docs/use-cases.md](plugins/jira-tools/docs/use-cases.md) · spec: [SPEC.md](SPEC.md).

## Requirements

- Node.js ≥ 20 (`node -v`)
- Jira access (VPN if needed) + your own Personal Access Token: Jira → avatar → **Personal Access Tokens** → **Create token**

## Install

Same repository, two apps:

**Claude Desktop** — Settings → **Plugins** → **Add** → **Add from a repository** →
paste `https://github.com/magic-lewko/magic-jira-mcp` → turn on **Sync automatically** → Add.

**Claude Code** — run:

```text
/plugin marketplace add https://github.com/magic-lewko/magic-jira-mcp
/plugin install jira-tools@magic-jira-mcp
```

## Configure

Run the setup skill (`/jira-tools:jira-setup` in Claude Code, or just ask
"set up Jira" in Desktop) and give it your Jira URL, token, language and default project.
Then `/jira-tools:jira-config PROJ` to save the project profile.

Done when you see "Logged in as …". Then try `show my tasks in PROJ`.

## Updates

New versions ship to the repo's `main` branch. With **Sync automatically** on, Desktop
picks them up; otherwise re-sync the marketplace (Plugins → Add → the repo → Sync). In
Claude Code: `/plugin marketplace update magic-jira-mcp` then `/plugin install jira-tools@magic-jira-mcp`.

## What it does

Read: my tasks, ticket details/ranges, status history, boards/sprints, epic
status, **sprint health report**, **find a bug by description + environment**, story audit.

Write: create tickets per platform, edit fields, comment, attach files, change
status, link issues, assign to epic. Creation always shows a preview and waits
for your confirmation.

Skills: `jira-setup`, `jira-config`, `get-tasks`, `sprint-health`, `check-stories`,
`find-bug`, `create-task`, `feedback`.

## Safety

Session budget (hard stop against creation loops) · duplicate guard · one ticket
per call · `/create-task` always previews first · AI-created tickets get an
`ai-generated` label.

## For developers

```text
npm install
npm test            # unit tests
npm run build       # server bundle (after every change in src/)
npm run selftest    # self-test on a live board (-- --write)
```

Branches: `develop` → `uat` → `main`.
