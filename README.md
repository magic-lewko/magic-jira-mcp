# jira-tools 🎫 — Jira, but you just ask Claude

Stop clicking around Jira. Ask Claude instead — *"show my tasks in PROJ"*, *"sprint health for PROJ"*, *"create a bug on iOS"*. One MCP server, two homes: **Claude Code** (devs) and **Claude Desktop / Cowork** (analysts, PMs). 16 tools, 9 skills, self-hosted Jira Server.

Full tour → [docs/use-cases.md](plugins/jira-tools/docs/use-cases.md) · the spec → [SPEC.md](SPEC.md)

---

## 👉 The only link you need

```text
https://github.com/magic-lewko/magic-jira-mcp
```

Copy it. That is the whole install source for both Claude Code and Desktop. The rest is a 30-second setup below.

---

## Before you start

- **Node.js 20+** — check with `node -v`.
- **Jira reachable** — VPN on, if your Jira needs it.
- **A Personal Access Token** — in Jira: avatar (top-right) → *Personal Access Tokens* → *Create token*. Copy it, you paste it once.

---

## Install — Claude Code (devs)

Paste these, top to bottom:

```text
/plugin marketplace add https://github.com/magic-lewko/magic-jira-mcp
/plugin install jira-tools@magic-jira-mcp
/jira-tools:jira-setup            # asks for URL + token → writes your config
/jira-tools:jira-config PROJ      # optional: richer project profile (board, statuses, templates)
```

You are done when you see **"Logged in as …"**. Then just ask: `show my tasks in PROJ`.

---

## Install — Claude Desktop / Cowork (analysts, PMs)

1. Add the link above as a plugin source (Settings → Plugins).
2. Put a **`.config/jira-tools/config.json`** in your working folder — this is where your URL + token live:

   ```json
   {
     "server": "https://jira.example.pl",
     "token": "<your-personal-access-token>",
     "language": "pl",
     "defaultProject": "PROJ"
   }
   ```

3. Ask: `who am I in Jira?` → you should see your own name.

> ⚠️ **Run it "On your computer", not "In the cloud".** The Jira tools connect only on your machine — a cloud task can't reach a self-hosted Jira.
>
> 🔑 The token sits in that file in plain text: give **each person their own** token, and never commit the file (it is git-ignored).

---

## Update

New versions land on `main`.

- **Claude Code:** `/plugin marketplace update magic-jira-mcp` → `/plugin install jira-tools@magic-jira-mcp` → `/jira-tools:jira-update` (tidies the config).
- **Desktop:** re-sync the plugin source.

Not sure which version you are on? Just ask **"what jira-tools version?"** — the connected server tells you the truth (`get_version`).

---

## What you get

**Read** — your tasks, ticket detail, status history, boards, sprints, epic roll-ups, a full sprint-health report, bug search by description, story audit.

**Write** — create tickets per platform, edit fields, comment, attach files, move status, link tickets, attach to an epic. Every write shows a preview first.

## Guardrails

- Session budget kills a runaway create-loop.
- Duplicate guard blocks a repeat ticket.
- One ticket per call.
- `/jira-tools:create-task` always previews before it creates.
- Every ticket the plugin creates gets an `ai-generated` label.

## For developers

```text
npm install
npm test          # unit tests
npm run build     # rebuild the server bundle after any change in src/
npm run selftest  # live-board self-test (add -- --write for writes)
```

Branches: `develop` → `uat` → `main`.
