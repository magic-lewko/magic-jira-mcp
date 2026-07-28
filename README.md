# jira-claude-plugin

Rozmawiasz z Jirą po ludzku przez Claude — raporty sprintu, szukanie bugów po opisie,
zakładanie i edycja ticketów. Jeden serwer MCP działa w Claude Desktop i w Claude Code.

16 narzędzi · 8 skilli. Pełne przykłady: [docs/use-cases.md](plugins/jira-tools/docs/use-cases.md) · specyfikacja: [SPEC.md](SPEC.md).

## Wymagania

- Node.js ≥ 20 (`node -v`)
- dostęp do Jiry (VPN, jeśli trzeba) + własny token PAT: Jira → awatar → **Personal Access Tokens** → **Create token**

## Claude Desktop

1. Pobierz repo w stałe miejsce: `git clone https://github.com/magic-lewko/magic-jira-mcp.git`
2. Claude Desktop → **Settings → Developer → Edit Config** → dopisz (popraw ścieżkę na `/`, URL i token):

   ```json
   {
     "mcpServers": {
       "jira": {
         "command": "node",
         "args": ["C:/sciezka/do/repo/plugins/jira-tools/servers/jira-mcp.mjs"],
         "env": { "JIRA_SERVER": "https://jira.example.pl", "JIRA_TOKEN": "<PAT>" }
       }
     }
   }
   ```

3. Zrestartuj Claude Desktop → zapytaj „kim jestem w Jirze?".

Pytasz naturalnym językiem — komendy `/…` są tylko w Claude Code.

## Claude Code

Dodaj marketplace i zainstaluj plugin:

```text
/plugin marketplace add https://github.com/magic-lewko/magic-jira-mcp
/plugin install jira-tools@magic-jira-mcp
/jira-tools:jira-setup          # URL, token, język, projekt
/jira-tools:jira-config PROJ    # profil projektu
```

Gotowe, gdy zobaczysz „Zalogowano jako …". Potem np. `pokaż moje taski w PROJ`.

## Co potrafi

Odczyt: moje taski, szczegóły/zakresy ticketów, historia statusów, boardy/sprinty,
status epica, **raport zdrowia sprintu**, **szukanie buga po opisie + środowisko**, audyt stories.

Zapis: tworzenie ticketów per platforma, edycja pól, komentarze, załączniki, zmiana statusu,
linkowanie, przypięcie do epica. Tworzenie zawsze z podglądem i potwierdzeniem.

Skille: `jira-setup`, `jira-config`, `get-tasks`, `sprint-health`, `check-stories`,
`find-bug`, `create-task`, `feedback`.

## Bezpieczeństwo

Budżet sesji (twardy stop przed pętlą tworzenia) · strażnik duplikatów · jeden ticket na
wywołanie · `/create-task` zawsze z dry-runem · tickety od AI mają labelkę `ai-generated`.

## Dla developerów

```text
npm install
npm test            # testy unit
npm run build       # bundle serwera (po każdej zmianie w src/)
npm run selftest    # self-test na żywej tablicy (-- --write)
```

Gałęzie: `develop` → `uat` → `main`.
