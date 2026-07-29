# jira-claude-plugin

Use Claude to work with Jira. One MCP server works in Claude Desktop and Claude Code.
The plugin has 16 tools and 9 skills. See the usage in [docs/use-cases.md](plugins/jira-tools/docs/use-cases.md). See the spec in [SPEC.md](SPEC.md).

## Requirements

- Node.js 20 or later. Check the version with `node -v`.
- Access to Jira. Turn on the VPN if your Jira needs it.
- A Personal Access Token. In Jira, open the avatar menu. Then select Personal Access Tokens. Then select Create token.

## Install

**Claude Desktop.** Open Settings. Go to Plugins. Click Add. Click "Add from a repository".
Paste `https://github.com/magic-lewko/magic-jira-mcp`. Turn on "Sync automatically". Click Add.
Then open the plugin settings and type the Jira URL and the token.

**Claude Code.** Run these commands:

```text
/plugin marketplace add https://github.com/magic-lewko/magic-jira-mcp
/plugin install jira-tools@magic-jira-mcp
/jira-tools:jira-setup          # URL, token, language, project
/jira-tools:jira-config PROJ    # project profile
```

The setup is done when you see "Logged in as …". Then ask `show my tasks in PROJ`.

## Update

New versions go to the `main` branch.
In Claude Code, run `/plugin marketplace update magic-jira-mcp`. Then run `/plugin install jira-tools@magic-jira-mcp`.
In Claude Desktop, sync the marketplace again. "Sync automatically" does this for you.
After an update in Claude Code, run `/jira-tools:jira-update` to clean the config.

## What it does

Read: your tasks, ticket details, status history, boards, sprints, epic status, the sprint health report, a bug search by description, and a story audit.
Write: create tickets per platform, edit fields, add comments, attach files, change status, link tickets, and attach tickets to an epic. Each write shows a preview first.

## Safety

- The session budget stops a create loop.
- The duplicate guard blocks a repeat ticket.
- The plugin creates one ticket per call.
- `/jira-tools:create-task` shows a preview first.
- The plugin adds the `ai-generated` label to each ticket it creates.

## For developers

```text
npm install
npm test            # unit tests
npm run build       # build the server bundle after each change in src/
npm run selftest    # self-test on a live board. Add -- --write for writes.
```

Branches: `develop`, then `uat`, then `main`.
