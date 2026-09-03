# jira-tools

Ask Claude about your self-hosted Jira instead of clicking around it. Examples: "show my tasks in PROJ", "sprint health for PROJ", "create a bug on iOS". One MCP server, two homes: Claude Code and Claude Desktop. 18 tools, 9 skills.

Full tour: [docs/use-cases.md](plugins/jira-tools/docs/use-cases.md). Spec: [SPEC.md](SPEC.md).

## The only link you need

```text
https://github.com/magic-lewko/magic-jira-mcp
```

Copy it. That is the whole install source for both Claude Code and Claude Desktop.

## Before you start

- Node.js 20 or later. Check with `node -v`.
- Jira reachable. Turn on the VPN if your Jira needs it.
- A Personal Access Token. In Jira: avatar (top right), then Personal Access Tokens, then Create token.

## Install in Claude Code

```text
/plugin marketplace add https://github.com/magic-lewko/magic-jira-mcp
/plugin install jira-tools@magic-jira-mcp
/jira-tools:jira-setup            # asks for URL and token, writes the config
/jira-tools:jira-config PROJ      # optional: project profile (board, statuses, templates)
```

Done when you see "Logged in as ...". Then ask: show my tasks in PROJ.

## Install in Claude Desktop

1. Settings, then Plugins, then Add, then Add marketplace, then Add from a repository. Paste the link above.
2. Fill in your Jira URL and Personal Access Token when it asks.
3. Ask: who am I in Jira? You should see your own name.

Run it "On your computer", not "In the cloud". The Jira tools connect only on your machine.

## Update

New versions land on `main`.

- Claude Code: `/plugin marketplace update magic-jira-mcp`, then `/plugin install jira-tools@magic-jira-mcp`, then `/jira-tools:jira-update`.
- Claude Desktop: re-sync the plugin.

Ask "what jira-tools version?" to see which version is connected.

## What it does

Read: your tasks, ticket detail, status history, boards, sprints, epic status, a sprint health report, a bug search by description, a story audit.

Write: create tickets per platform or a whole breakdown (epic, stories, sub-tasks, also in bulk), edit fields, set Story Points, comment, attach files, change status, link tickets, attach to an epic. Descriptions are Markdown and render as Jira wiki markup. Every write shows a preview first.

## Guardrails

- Session budget stops a runaway create loop (default 100 creates, 300 writes; raise with `writeBudget` in the config).
- Duplicate guard blocks a repeat ticket.
- One ticket per call.
- `/jira-tools:create-task` previews before it creates.
- Every created ticket gets an `ai-generated` label.

## For developers

```text
npm install
npm test          # unit tests
npm run build     # rebuild the server bundle after any change in src/
npm run selftest  # live-board self-test (add -- --write for writes)
```

Branches: `develop`, then `uat`, then `main`.
