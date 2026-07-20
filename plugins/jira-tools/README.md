# jira-tools — plugin Claude Code dla Jira Server

Serwer MCP + skille integrujące self-hosted **Jira Server** (REST API v2, token PAT).
Read-only domyślnie; narzędzia zapisu (Faza 2) włącza dopiero flaga `JIRA_ALLOW_WRITE=true`.

## Zanim zaczniesz (obie ścieżki)

| Potrzebujesz | Jak sprawdzić / zdobyć |
| --- | --- |
| Node.js >= 20 | terminal: `node -v` (brak → [nodejs.org](https://nodejs.org), wersja LTS) |
| dostęp do firmowej Jiry | otwórz Jirę w przeglądarce (VPN, jeśli wymagany) |
| własny token PAT | Jira → **awatar (prawy górny róg)** → **Personal Access Tokens** → **Create token** → skopiuj (pokaże się tylko raz) |

## Szybki start — dev (Claude Code, ~5 min)

1. Dodaj źródło pluginu (URL prywatnego repo albo ścieżka lokalna):

   ```text
   /plugin marketplace add <URL-repo-albo-ścieżka>
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
   Pełna lista możliwości: [docs/use-cases.md](docs/use-cases.md).

## Konfiguracja ręczna (bez skilla)

Plik `~/.config/jira-tools/config.json` (Windows: `%USERPROFILE%\.config\jira-tools\config.json`):

```json
{
  "server": "https://jira.example.pl",
  "token": "<twój PAT>",
  "language": "pl",
  "defaultProject": "PROJ",
  "allowWrite": false,
  "projects": {
    "PROJ": {
      "boardId": 123,
      "boardName": "PROJ board",
      "statuses": ["To Do", "To Fix", "In Progress", "Code Review", "Dev Done", "On Hold", "Ready for QA", "QA", "Done"],
      "epicLinkField": "customfield_XXXXX",
      "components": ["Frontend", "Backend"]
    }
  }
}
```

Na macOS/Linux nadaj prawa `chmod 600`. Zamiast pliku możesz użyć zmiennych środowiskowych
(`JIRA_SERVER`, `JIRA_TOKEN`, `JIRA_ALLOW_WRITE`, `JIRA_DEFAULT_PROJECT`, `JIRA_LANG`) — env wygrywa z plikiem.
**Token nigdy nie trafia do repo.**

## Szybki start — PM / analityk (Claude Desktop, ~10 min)

Nie potrzebujesz Claude Code ani terminala do codziennej pracy — tylko jednorazowej konfiguracji:

1. **Pobierz pliki pluginu** w stałe miejsce na dysku (nie na Pulpit), np. `C:\narzedzia\magic-jira-mcp`
   — `git clone <URL-repo>` albo ZIP z repo (Code → Download ZIP → rozpakuj).

2. **Otwórz konfigurację Claude Desktop**: Claude Desktop → **Settings → Developer → Edit Config**
   (otworzy się plik `claude_desktop_config.json`).

3. **Wklej wpis serwera** (popraw ścieżkę z kroku 1 — ukośniki `/`, nie `\` — oraz URL Jiry i token):

   ```json
   {
     "mcpServers": {
       "jira": {
         "command": "node",
         "args": ["C:/narzedzia/magic-jira-mcp/plugins/jira-tools/servers/jira-mcp.mjs"],
         "env": {
           "JIRA_SERVER": "https://jira.example.pl",
           "JIRA_TOKEN": "<twój PAT>"
         }
       }
     }
   }
   ```

   Jeśli plik ma już sekcję `mcpServers`, dopisz do niej tylko blok `"jira": { … }`.

4. **Zrestartuj Claude Desktop** (całkiem zamknij i uruchom ponownie).

5. ✅ **Test**: zapytaj w nowej rozmowie „kim jestem w Jirze?" — odpowiedź „Zalogowano jako …" = działa.
   Potem np. „zrób raport zdrowia aktualnego sprintu w TWÓJPROJEKT".

W Desktopie nie ma komend `/…` — pytasz naturalnym językiem, wszystkie przykłady:
[docs/use-cases.md](docs/use-cases.md).

Najczęstsze potknięcia: ścieżka z `\` zamiast `/` (krok 3) · brak restartu (krok 4) ·
brak Node.js (`node -v` w terminalu) · wygasły token (wygeneruj nowy PAT).

## Co dostajesz

**Narzędzia MCP (serwer `jira`, read-only):** `search_issues` (dowolny JQL), `get_issue`
(pełny detal, zakresy `PROJ-98..111`), `list_boards`, `get_active_sprint`, `get_sprint_issues`,
`get_epic_status`, `get_issue_changelog` (historia statusów), `get_current_user`,
`get_project_config` (profil projektu).

**Narzędzia zapisu (tylko z `allowWrite: true` + zgoda per projekt):** `create_issue`, `add_comment`, `transition_issue`, `assign_to_epic`.

**Skille:**

| Skill | Do czego |
| --- | --- |
| `/jira-tools:jira-setup` | pierwsza konfiguracja połączenia |
| `/jira-tools:jira-config PROJ` | profil projektu (board, statusy, Epic Link) |
| `/jira-tools:get-tasks PROJ [sprint] [tags:a,b]` | moje taski |
| `/jira-tools:sprint-health [board]` | raport zdrowia aktywnego sprintu (5 sekcji) |
| `/jira-tools:check-stories PROJ [sprint]` | audyt user stories (sprint / numer `[...]` w tytule) |
| `/jira-tools:find-bug <opis>` | znajdź buga po opisie słownym, status + środowisko |
| `/jira-tools:create-task <opis>` | (zapis) tickety per platforma, ZAWSZE z dry-runem |
| `/jira-tools:feedback [opis]` | pomysł/problem z pluginem → gotowa wiadomość na Slacka |

Poza skillami pytaj naturalnie: „które moje taski w PROJ zmieniły wczoraj status?",
„czy bug z licznikiem powiadomień jest już na UAT?" — Claude sam złoży JQL.

**Pełny katalog use case'ów z przykładowymi promptami** (ściąga dla PM/analityka/deva):
[docs/use-cases.md](docs/use-cases.md).

## Włączanie zapisu (opcjonalne, domyślnie wyłączony)

Zapis (`create_issue`, `add_comment`, `transition_issue` + skill `/jira-tools:create-task`)
włącza się per użytkownik: `"allowWrite": true` w configu (albo env `JIRA_ALLOW_WRITE=true`),
potem `/reload-plugins`. Bez flagi narzędzia zapisu w ogóle nie istnieją w serwerze.

Wbudowane bezpieczniki (w kodzie serwera):

- **bezpiecznik per projekt (opt-in)** — nawet w trybie zapisu projekt można zapisywać
  TYLKO, gdy jego profil ma `"allowWrite": true` (`projects.KEY` w configu; pyta o to
  `/jira-tools:jira-config`) albo klucz jest w `writeProjects` / env `JIRA_WRITE_PROJECTS`.
  Działa od razu, bez restartu — projekty produkcyjne zostają read-only, dopóki ktoś
  świadomie ich nie odblokuje,
- **hook chroniący bezpieczniki** — plugin instaluje hook, który wymusza ręczne
  potwierdzenie każdej próby zmiany pól `allowWrite` w configu (także sprytnych, typu
  podmiana samego `false`→`true`); agent nie włączy sobie zapisu sam. Uwaga: w trybach
  auto/bypassPermissions Claude Code pomija prompty — tam hook nie chroni,
- **jeden ticket na wywołanie** — brak API batchowego,
- **budżet zapisu na sesję** — domyślnie 10 utworzeń / 30 operacji zapisu łącznie; po
  przekroczeniu serwer odmawia aż do restartu (`/reload-plugins`). Zmiana limitu: pole
  `"writeBudget": {"creates": 10, "total": 30}` w configu lub env
  `JIRA_WRITE_BUDGET_CREATES` / `JIRA_WRITE_BUDGET_TOTAL`,
- **strażnik duplikatów** — próba utworzenia ticketa o tytule istniejącego, otwartego
  zadania w projekcie zostaje odrzucona ze wskazaniem klucza (świadome obejście:
  `allow_duplicate=true`),
- `/jira-tools:create-task` ZAWSZE pokazuje pełny podgląd (dry-run) i czeka na Twoje
  potwierdzenie, zanim cokolwiek utworzy.

**Oznaczanie treści AI:** domyślnie (`"aiLabel": true`, pyta o to `/jira-tools:jira-setup`)
tickety tworzone przez agenta dostają labelkę `ai-generated` (odfiltrujesz je w JQL:
`labels = ai-generated`), a komentarze — krótki podpis. Zawsze wiadomo, co dodał człowiek,
a co wygenerowało AI.

**Zalecenie:** przy pytaniu Claude Code o uprawnienie dla `create_issue` nie wybieraj
„always allow" — zatwierdzanie każdego utworzenia ręcznie to ostatnia warstwa ochrony.
Testy zapisu wykonuj wyłącznie na sandboksie testowym, nigdy na projekcie produkcyjnym.

## Mniej pytań o uprawnienia (Claude Code, opcjonalnie)

Żeby odczyty nie pytały o zgodę przy każdym wywołaniu, dodaj do `.claude/settings.json`
projektu (albo swoich ustawień użytkownika) gotowy zestaw — **wyłącznie narzędzia odczytu**:

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

**Świadomie NIE dodawaj** narzędzi zapisu (`create_issue`, `add_comment`,
`transition_issue`, `assign_to_epic`) — ręczne potwierdzanie każdego zapisu to ostatnia
warstwa bezpieczeństwa i ma tak zostać.

Tip per repo: w tym samym pliku możesz ustawić domyślny projekt dla danego katalogu:
`"env": { "JIRA_DEFAULT_PROJECT": "PROJ" }` (env wygrywa z configiem użytkownika).

## Checklista testu end-to-end (na czystej instalacji)

1. `claude` w dowolnym katalogu → `/plugin marketplace add <ścieżka/URL>`
2. `/plugin install jira-tools@magic-jira-mcp`
3. `/jira-tools:jira-setup` → „Zalogowano jako …"
4. `/mcp` → serwer `jira` widoczny i connected
5. `/jira-tools:get-tasks <PROJEKT>` → zwraca Twoje taski
6. Pytanie naturalne: „które moje taski w `PROJEKT` zmieniły status wczoraj?"
7. `/jira-tools:sprint-health` → raport z pięcioma sekcjami
8. Po zmianach w kodzie: `npm run build` + `/reload-plugins` (SKILL.md łapie się na żywo, kod serwera i `.mcp.json` wymagają reloadu)

## Troubleshooting

- **Serwer `jira` nie łączy się** → `/mcp` pokaże błąd. Najczęstsza przyczyna przy zmianach w kodzie: cokolwiek wypisane na **stdout** w serwerze (stdout = protokół MCP). Debug wyłącznie na stderr, włączany przez `JIRA_DEBUG=1`.
- **401 / „token wygasł"** → wygeneruj nowy PAT (Jira → awatar → Personal Access Tokens) i odpal `/jira-tools:jira-setup` ponownie.
- **Timeout** → sprawdź URL serwera i VPN.
- **„Poprawka nie działa"** → kod serwera wymaga `npm run build` + `/reload-plugins`; sam `SKILL.md` przeładowuje się na żywo.

## Dla developerów pluginu

- Kod źródłowy: `plugins/jira-tools/src/` (ESM, zero zależności runtime poza `@modelcontextprotocol/sdk` i `zod`).
- `npm test` — testy unit (`node:test`, mock fetch). Pojedynczy plik: `node --test tests/unit/format.test.mjs`.
- `npm run build` — bunduje `src/` do self-contained `servers/jira-mcp.mjs` (esbuild). **Obowiązkowe po każdej zmianie w `src/`** — instalowany jest bundle, nie źródła.
- `npm run test:integration` — testy read-only na żywej Jirze; wymagają `JIRA_TEST_SERVER` + `JIRA_TEST_TOKEN` (albo lokalnego `.env.local`), opcjonalnie `JIRA_TEST_PROJECT`/`JIRA_TEST_ISSUE`.
- `claude plugin validate .` — walidacja manifestów.
- [docs/test-plan.md](docs/test-plan.md) — pełny plan testów manualnych (instalacja, odczyt,
  zapis, bezpieczniki, złota zasada „bez wymyślania treści") do przeklikania przed
  wydaniem zmian użytkownikom.
