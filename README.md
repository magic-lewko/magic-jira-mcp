# jira-claude-plugin

Rozmawiasz z Jirą po ludzku przez Claude — raporty sprintu, szukanie bugów po opisie,
zakładanie ticketów per platforma. Jeden serwer MCP działa w Claude Code (dev) i Claude
Desktop (PM/analityk). Domyślnie **tylko do odczytu**; zapis włączasz świadomie.

16 narzędzi · 8 skilli · bezpieczniki w kodzie serwera. Pełne przykłady:
[docs/use-cases.md](plugins/jira-tools/docs/use-cases.md) · specyfikacja: [SPEC.md](SPEC.md).

## Wymagania

- Node.js ≥ 20 (`node -v`)
- dostęp do Jiry (VPN, jeśli trzeba) + własny token PAT (Jira → awatar → **Personal Access Tokens** → **Create token**)

## Instalacja — Claude Code (dev)

```text
/plugin marketplace add <URL-repo-albo-ścieżka>
/plugin install jira-tools@magic-jira-mcp
/jira-tools:jira-setup          # URL, token, język, tryb pracy
/jira-tools:jira-config PROJ    # profil projektu
```

Gotowe, gdy zobaczysz „Zalogowano jako …". Potem np. `pokaż moje taski w PROJ`.

## Instalacja — Claude Desktop (PM/analityk)

1. Pobierz repo w stałe miejsce (`git clone …`).
2. **Settings → Developer → Edit Config** → dopisz (popraw ścieżkę `/`, URL i token):

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

## Co potrafi

Odczyt: moje taski, szczegóły/zakresy ticketów, historia statusów, boardy/sprinty,
status epica, **raport zdrowia sprintu**, **szukanie buga po opisie + środowisko**, audyt stories.

Zapis (za `allowWrite` + zgodą per projekt): tworzenie ticketów per platforma, edycja pól,
komentarze, załączniki, zmiana statusu, linkowanie, przypięcie do epica — zawsze z podglądem.

Skille: `jira-setup`, `jira-config`, `get-tasks`, `sprint-health`, `check-stories`,
`find-bug`, `create-task`, `feedback`.

## Bezpieczeństwo

Read-only domyślnie · zapis per projekt · budżet sesji (ochrona przed pętlą) · strażnik
duplikatów · hook chroniący ustawienia · labelka `ai-generated` · dry-run przed każdym zapisem.

## Dla developerów

```text
npm install
npm test            # testy unit
npm run build       # bundle serwera (po każdej zmianie w src/)
npm run selftest    # self-test na żywej tablicy (-- --write)
```

Gałęzie: `develop` → `uat` → `main`.
