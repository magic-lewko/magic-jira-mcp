---
name: jira-setup
description: Interactive first-time setup of the Jira connection - asks for the Jira Server URL, guides the user through generating a Personal Access Token, asks for language and default project, saves ~/.config/jira-tools/config.json and verifies the login. Use when the user wants to configure Jira access, mentions "setup jira", "skonfiguruj jirę", or when Jira tools report that Jira is not configured yet.
---

Guide the user through configuring the Jira connection. Respond in the user's language (this team usually speaks Polish). Never print the token back to the user once provided, never store it anywhere except the config file below.

## Steps

1. **Collect settings** — ask the user for (one message, all questions at once):
   - Jira Server base URL (e.g. `https://jira.example.pl` — no trailing slash needed).
   - Personal Access Token. Tell them how to generate one: Jira → click your avatar (top right) → **Personal Access Tokens** → **Create token** (no expiry or long expiry recommended). Ask them to paste the token.
   - Preferred language for generated ticket content: `pl` or `en` (default `pl`).
   - Default project key (optional, e.g. `PROJ`).

2. **Write the config file** to `~/.config/jira-tools/config.json` (Windows: `%USERPROFILE%\.config\jira-tools\config.json`). Create the directory if missing. Merge with existing content if the file already exists (do not drop an existing `projects` section). Shape:

   ```json
   {
     "server": "https://jira.example.pl",
     "token": "<token>",
     "language": "pl",
     "defaultProject": "PROJ",
     "allowWrite": false
   }
   ```

3. **Restrict permissions** (POSIX only): `chmod 600 ~/.config/jira-tools/config.json`. On Windows skip this step silently.

4. **Verify the connection** by calling the `get_current_user` MCP tool (server `jira`). On success show its output ("Zalogowano jako …"). The server re-reads the config on every call, so no reload is needed.
   - 401 → the token is wrong/expired; ask for a fresh one and update the file.
   - Connection error/timeout → ask the user to check the URL and VPN.

5. **Suggest the next step**: run `/jira-tools:jira-config <PROJECT>` to save a project profile (board, status columns, epic link field) — it makes sprint reports and epic queries much more accurate.
