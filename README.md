# jira-claude-plugin

Plugin Claude Code integrujący self-hosted **Jira Server** (REST API v2, token PAT) z Claude —
serwer MCP + skille. Rozmawiasz z Jirą po ludzku: raporty sprintu, szukanie bugów po opisie,
zakładanie ticketów per platforma. Jeden serwer działa i w Claude Code (developerzy), i w
Claude Desktop (PM / analitycy).

Domyślnie **tylko do odczytu** — zapis włączasz świadomie, per użytkownik i per projekt.

- 16 narzędzi MCP (9 odczyt, 7 zapis) · 8 skilli
- Bezpieczniki egzekwowane w kodzie serwera (nie w promptach)
- Specyfikacja: [SPEC.md](SPEC.md) · Ściąga z przykładami: [plugins/jira-tools/docs/use-cases.md](plugins/jira-tools/docs/use-cases.md)

## Wymagania

| Potrzebujesz | Jak sprawdzić / zdobyć |
| --- | --- |
| Node.js ≥ 20 | terminal: `node -v` (brak → [nodejs.org](https://nodejs.org), wersja LTS) |
| dostęp do firmowej Jiry | otwórz Jirę w przeglądarce (VPN, jeśli wymagany) |
| własny token PAT | Jira → **awatar (prawy górny róg)** → **Personal Access Tokens** → **Create token** → skopiuj (pokaże się tylko raz) |

## Instalacja — developer (Claude Code, ~5 min)

1. Dodaj źródło pluginu (URL tego repo albo ścieżka lokalna):

   ```text
   /plugin marketplace add <URL-repo-albo-ścieżka-lokalna>
   ```

2. Zainstaluj:

   ```text
   /plugin install jira-tools@magic-jira-mcp
   ```

3. Skonfiguruj — skill poprowadzi Cię przez URL, token, język i tryb pracy:

   ```text
   /jira-tools:jira-setup
   ```

   ✅ Kryterium sukcesu: „**Zalogowano jako …**" z Twoim nazwiskiem.

4. Zapisz profil swojego projektu (kolumny, pole Epic Link, konwencje zespołu):

   ```text
   /jira-tools:jira-config TWÓJPROJEKT
   ```

5. Pierwszy strzał: `pokaż moje taski w TWÓJPROJEKT`.

Odświeżenie po aktualizacji pluginu:

```text
/plugin uninstall jira-tools@magic-jira-mcp
/plugin marketplace update magic-jira-mcp
/plugin install jira-tools@magic-jira-mcp
/reload-plugins
```

## Instalacja — PM / analityk (Claude Desktop, ~10 min)

Nie potrzebujesz Claude Code ani terminala do codziennej pracy — tylko jednorazowej konfiguracji.

1. **Pobierz pliki pluginu** w stałe miejsce (nie na Pulpit), np. `C:\narzedzia\jira-claude-plugin`
   — `git clone <URL-repo>` albo ZIP.

2. **Otwórz konfigurację Claude Desktop**: Claude Desktop → **Settings → Developer → Edit Config**.

3. **Wklej wpis serwera** (popraw ścieżkę — ukośniki `/`, nie `\` — oraz URL Jiry i token):

   ```json
   {
     "mcpServers": {
       "jira": {
         "command": "node",
         "args": ["C:/narzedzia/jira-claude-plugin/plugins/jira-tools/servers/jira-mcp.mjs"],
         "env": {
           "JIRA_SERVER": "https://jira.example.pl",
           "JIRA_TOKEN": "<twój PAT>"
         }
       }
     }
   }
   ```

   Jeśli plik ma już sekcję `mcpServers`, dopisz tylko blok `"jira": { … }`.

4. **Zrestartuj Claude Desktop** (całkiem zamknij i uruchom ponownie).

5. ✅ **Test**: zapytaj „kim jestem w Jirze?" — odpowiedź „Zalogowano jako …" = działa.

W Desktopie nie ma komend `/…` — pytasz naturalnym językiem.
Najczęstsze potknięcia: ścieżka z `\` zamiast `/` · brak restartu · brak Node (`node -v`) · wygasły token.

## Konfiguracja ręczna (bez skilla)

Plik `~/.config/jira-tools/config.json` (Windows: `%USERPROFILE%\.config\jira-tools\config.json`):

```json
{
  "server": "https://jira.example.pl",
  "token": "<twój PAT>",
  "language": "pl",
  "defaultProject": "PROJ",
  "allowWrite": false,
  "aiLabel": true,
  "projects": {
    "PROJ": {
      "boardId": 123,
      "boardName": "PROJ board",
      "statuses": ["To Do", "In Progress", "Code Review", "Done"],
      "epicLinkField": "customfield_XXXXX",
      "components": ["Frontend", "Backend"],
      "allowWrite": false
    }
  }
}
```

Zamiast pliku możesz użyć zmiennych środowiskowych (`JIRA_SERVER`, `JIRA_TOKEN`,
`JIRA_ALLOW_WRITE`, `JIRA_DEFAULT_PROJECT`, `JIRA_LANG`) — env wygrywa z plikiem.
**Token nigdy nie trafia do repo.**

## Co dostajesz

**Narzędzia MCP (serwer `jira`, odczyt):** `search_issues` (dowolny JQL), `get_issue`
(pełny detal, zakresy `PROJ-98..111`, tryb kompaktowy), `list_boards`, `get_active_sprint`,
`get_sprint_issues`, `get_epic_status`, `get_issue_changelog`, `get_current_user`,
`get_project_config`.

**Narzędzia zapisu (tylko z `allowWrite: true` + zgoda per projekt):** `create_issue`,
`update_issue` (assignee, labels, komponenty, priorytet, opis), `add_comment`,
`add_attachment` (plik z dysku, max 10 MB), `transition_issue`, `assign_to_epic`,
`link_issues` (Relates/Blocks/…).

**Skille:**

| Skill | Do czego |
| --- | --- |
| `/jira-tools:jira-setup` | pierwsza konfiguracja połączenia (`--reset` / `--update`) |
| `/jira-tools:jira-config PROJ` | profil projektu (board, statusy, Epic Link, szablony, konwencje) |
| `/jira-tools:get-tasks PROJ [sprint] [tags:a,b]` | moje taski |
| `/jira-tools:sprint-health [board]` | raport zdrowia aktywnego sprintu (5 sekcji) |
| `/jira-tools:check-stories PROJ [sprint]` | audyt user stories (sprint / numer `[123456]` w tytule) |
| `/jira-tools:find-bug <opis>` | znajdź buga po opisie słownym, status + środowisko |
| `/jira-tools:create-task <opis>` | (zapis) tickety per platforma, ZAWSZE z dry-runem |
| `/jira-tools:feedback [opis]` | pomysł/problem z pluginem → gotowa wiadomość na Slacka |

Poza skillami pytaj naturalnie: „które moje taski w PROJ zmieniły wczoraj status?",
„czy bug z licznikiem powiadomień jest już na UAT?" — Claude sam złoży JQL.
Pełny katalog przykładów: [plugins/jira-tools/docs/use-cases.md](plugins/jira-tools/docs/use-cases.md).

## Bezpieczeństwo zapisu (egzekwowane w kodzie serwera)

- **Read-only domyślnie** — zapis włącza `allowWrite: true` (`/jira-setup`) **+ zgoda per projekt** (`/jira-config`).
- **Hook chroniący ustawienia** — próba zmiany `allowWrite` przez agenta wymusza ręczne potwierdzenie; AI nie włączy sobie zapisu samo.
- **Budżet zapisu na sesję** — domyślnie 10 utworzeń / 30 operacji; po przekroczeniu twardy stop (ochrona przed pętlą).
- **Strażnik duplikatów** i **jeden ticket na wywołanie** — brak API batchowego.
- **Oznaczanie treści AI** — tickety od agenta dostają labelkę `ai-generated`, komentarze podpis (`aiLabel`, można wyłączyć).
- `/create-task` ZAWSZE pokazuje podgląd (dry-run) i czeka na potwierdzenie.

**Zalecenie:** przy pytaniu Claude Code o uprawnienie dla narzędzi zapisu nie wybieraj
„always allow" — zatwierdzanie ręczne to ostatnia warstwa ochrony. Testy zapisu wyłącznie
na projekcie testowym.

### Mniej pytań o uprawnienia (Claude Code, opcjonalnie)

Do `.claude/settings.json` projektu — **tylko narzędzia odczytu**:

```json
{
  "permissions": {
    "allow": [
      "mcp__plugin_jira-tools_jira__search_issues",
      "mcp__plugin_jira-tools_jira__get_issue",
      "mcp__plugin_jira-tools_jira__get_issue_changelog",
      "mcp__plugin_jira-tools_jira__list_boards",
      "mcp__plugin_jira-tools_jira__get_active_sprint",
      "mcp__plugin_jira-tools_jira__get_sprint_issues",
      "mcp__plugin_jira-tools_jira__get_epic_status",
      "mcp__plugin_jira-tools_jira__get_current_user",
      "mcp__plugin_jira-tools_jira__get_project_config"
    ]
  }
}
```

Narzędzi zapisu świadomie NIE dodawaj.

## Troubleshooting

| Objaw | Ratunek |
| --- | --- |
| „Jira nie jest skonfigurowana" | `/jira-tools:jira-setup` (albo uzupełnij config ręcznie) |
| 401 / token wygasł | nowy PAT (awatar → Personal Access Tokens) → `/jira-tools:jira-setup` |
| timeout / brak połączenia | sprawdź URL serwera i VPN |
| serwer `jira` nie łączy się | `/mcp` pokaże błąd; najczęstsza przyczyna przy zmianach w kodzie: stray `console.log` na stdout (stdout = protokół MCP) |
| narzędzia zapisu niewidoczne mimo `allowWrite: true` | `/reload-plugins` |
| dziwna kolejność statusów w raportach | `/jira-tools:jira-config PROJ` → wybierz właściwy board |

## Dla developerów pluginu

- Repo = marketplace + plugin. Właściwy plugin: `plugins/jira-tools/`. Kod źródłowy serwera: `plugins/jira-tools/src/` (ESM, zależności runtime: tylko `@modelcontextprotocol/sdk` i `zod`).
- `npm install` — zależności.
- `npm test` — testy unit (`node:test`, mock fetch). Pojedynczy plik: `node --test tests/unit/<plik>.test.mjs`.
- `npm run build` — bunduje `src/` do self-contained `plugins/jira-tools/servers/jira-mcp.mjs` (esbuild). **Obowiązkowe po każdej zmianie w `src/`** — instalowany jest bundle, nie źródła.
- `npm run test:integration` — testy read-only na żywej Jirze; wymagają `JIRA_TEST_SERVER` + `JIRA_TEST_TOKEN` (albo lokalnego `.env.local`).
- `npm run selftest` / `-- --write` — dev-owy self-test: prowadzi prawdziwe handlery narzędzi po żywym sandboxie (tworzy i kasuje testowe tickety), wypluwa tabelę ✓/✗.
- `claude plugin validate .` i `claude plugin validate ./plugins/jira-tools` — walidacja manifestów.
- Gałęzie: `develop` (praca) → `uat` (stage) → `main` (prod).
