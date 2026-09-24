# jira-tools

Ask Claude about your self-hosted Jira instead of clicking around it. Examples: "show my tasks in PROJ", "sprint health for PROJ", "create a bug on iOS". One MCP server, two homes: Claude Code and Claude Desktop. 18 tools, 9 skills.

Full tour: [docs/use-cases.md](plugins/jira-tools/docs/use-cases.md). Spec: [SPEC.md](SPEC.md).

## The only link you need

```text
https://github.com/magic-lewko/magic-jira-mcp
```

Copy it. That is the install source for Claude Code. Claude Desktop uses a one-file bundle (see below).

## Before you start

- For Claude Code: Node.js 20 or later. Check with `node -v`. Claude Desktop does not need Node.js.
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

Claude Desktop installs the tools from one file: `jira-tools-<version>.mcpb`. Get the file from the release page or from the maintainer.

1. Double-click the file. Claude Desktop opens the install window.
2. Fill in your Jira URL and Personal Access Token. Click Install.
3. Ask: who am I in Jira? You should see your own name.

If the double-click does nothing: Settings, then Extensions, then Advanced settings, then Install Extension. Pick the file.

The tools run on your computer. Turn on the VPN before you ask about Jira. The slash commands (skills) are for Claude Code only. In Claude Desktop, ask in plain words.

To build the file yourself: `npm run build:mcpb`. The result lands in `dist/`.

## Update

New versions land on `main`.

- Claude Code: `/plugin marketplace update magic-jira-mcp`, then `/plugin install jira-tools@magic-jira-mcp`, then `/jira-tools:jira-update`.
- Claude Desktop: install the new `.mcpb` file. It replaces the old version.

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
