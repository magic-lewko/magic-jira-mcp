# SPEC — Plugin Claude Code: integracja z Jira Server (self-hosted)

> Ten dokument jest źródłem prawdy dla implementacji. Buduj dokładnie to, co tu opisano.
> Przy niejasnościach: zapytaj, zanim zaimplementujesz. Nie dodawaj funkcji spoza specyfikacji.

## 1. Cel

Wewnętrzny (prywatny, nie publikowany) plugin Claude Code dla całej firmy — różne zespoły,
różne boardy — integrujący self-hosted **Jira Server** (nie Cloud!) przez REST API v2
z autoryzacją **Bearer PAT**. Repo jest bezosobowe: zero danych firmowych (§10).

Dwie grupy odbiorców:

- **Devowie** — używają przez Claude Code (slash commands + naturalny język przez MCP).
- **PM/analitycy** — używają tego samego serwera MCP przez Claude Desktop / Cowork.

## 2. Kontekst techniczny (stałe założenia)

- Jira: self-hosted, np. `https://jira.example.pl` (URL konfigurowalny, NIGDY hardkodowany).
- API: `GET/POST {JIRA_SERVER}/rest/api/2/...`, nagłówek `Authorization: Bearer <PAT>`.
- Agile API (sprinty/boardy): `{JIRA_SERVER}/rest/agile/1.0/...`.
- Runtime: Node.js >= 20, czysty ESM (`.mjs`), **zero zewnętrznych zależności runtime**
  poza `@modelcontextprotocol/sdk` i `zod` (walidacja parametrów narzędzi).
- Istnieją działające skrypty referencyjne w `references/` — pokazują sprawdzony wzorzec
  fetch/auth/formatowania. Reużyj tej logiki (nagłówki, obsługa błędów, ekspansja zakresów
  kluczy `PROJ-98..PROJ-111`, paginacja, dry-run przed zapisem).

## 3. Struktura repozytorium (monorepo = marketplace + plugin)

```text
.
├── .claude-plugin/
│   └── marketplace.json          # marketplace "magic-jira-mcp" → ./plugins/jira-tools
├── plugins/
│   └── jira-tools/
│       ├── .claude-plugin/
│       │   └── plugin.json
│       ├── .mcp.json             # definicja serwera MCP (stdio, ${CLAUDE_PLUGIN_ROOT})
│       ├── servers/
│       │   └── jira-mcp.mjs      # serwer MCP (single-file, self-contained po bundlingu)
│       ├── src/                  # kod źródłowy serwera podzielony na moduły
│       │   ├── jira-client.mjs   # warstwa HTTP: auth, fetch, paginacja, błędy
│       │   ├── config.mjs        # ładowanie konfiguracji (env → plik → błąd z instrukcją)
│       │   ├── format.mjs        # kompaktowe formatowanie ticketów do tekstu
│       │   └── tools/            # jeden plik = jedno narzędzie MCP
│       ├── skills/
│       │   ├── jira-setup/SKILL.md
│       │   ├── jira-config/SKILL.md
│       │   ├── get-tasks/SKILL.md
│       │   ├── sprint-health/SKILL.md
│       │   ├── check-stories/SKILL.md
│       │   ├── find-bug/SKILL.md
│       │   └── create-task/SKILL.md
│       └── README.md             # instrukcja instalacji i konfiguracji dla zespołu
├── references/                   # generyczne skrypty wzorcowe (dane firmowe tylko przez args/pliki)
│   ├── jira_show.mjs             # pełny detal ticketów + ekspansja zakresów (wzorzec get_issue)
│   ├── jira_list.mjs             # search + paginacja + kompaktowa lista (wzorzec search_issues)
│   ├── jira_create_subtasks.mjs  # POST issue + dry-run/--apply, plan z JSON (wzorzec create_issue)
│   ├── jira_label_updater.mjs    # GET+PUT labels bez duplikatów (wzorzec aktualizacji)
│   └── jira_unify_names.mjs      # bezpieczny PUT: weryfikacja stanu live, mapa z JSON
├── scripts/
│   └── build.mjs                 # esbuild: bunduje src/ → servers/jira-mcp.mjs (npm run build)
├── tests/
│   ├── unit/                     # testy z mockowanym fetch (node:test)
│   └── integration/              # testy read-only na prawdziwej Jirze (opt-in przez env)
├── SPEC.md                       # ten plik
└── CLAUDE.md                     # skrócone zasady pracy nad repo
```

## 4. Serwer MCP — narzędzia

Transport: **stdio**. Nazwa serwera: `jira`. Wszystkie narzędzia zwracają **zwięzły tekst**
(nie surowy JSON), zoptymalizowany pod kontekst LLM. Każde narzędzie waliduje wejście zod-em.

### 4.1 Odczyt (priorytet — faza 1)

| Narzędzie             | Parametry                                                                                             | Opis                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_issues`       | `jql` (string, wymagany), `max_results` (int, domyślnie 30, max 100), `fields` (string[], opcjonalne) | Wykonuje dowolny JQL. Fundament — Claude sam składa JQL dla pytań w naturalnym języku. Zwraca kompaktową listę: klucz, typ, status, priorytet, assignee, tytuł, labels, updated. |
| `get_issue`           | `key` lub `keys` (obsłuż też zakres `PROJ-98..111`), `all_comments?`                                  | Pełny detal: opis, komentarze (autor+data), załączniki (nazwy+URL), komponenty, epic/parent. Oszczędność kontekstu: domyślnie 5 ostatnich komentarzy i opis do 4000 znaków z jawnym dopiskiem o przycięciu; `all_comments=true` znosi limity.  |
| `list_boards`         | `project` (opcjonalny)                                                                                | Boardy Agile (potrzebne do znalezienia sprintu).                                                                                                                                 |
| `get_active_sprint`   | `board_id`                                                                                            | Aktywny sprint boardu: nazwa, daty, cel.                                                                                                                                         |
| `get_sprint_issues`   | `sprint_id` lub (`board_id` + `sprint_name`)                                                          | Taski sprintu, kompaktowo.                                                                                                                                                       |
| `get_epic_status`     | `epic_key`                                                                                            | Zliczenie dzieci epica per status + lista otwartych. Pole Epic Link różni się per instancja — bierz z profilu projektu (§5.1) lub auto-wykryj przez `/rest/api/2/field`.         |
| `get_issue_changelog` | `key`                                                                                                 | Historia zmian statusów z datami (potrzebne do "co zmieniło status na done wczoraj" i "bez ruchu 3 dni").                                                                        |
| `get_current_user`    | —                                                                                                     | Weryfikacja połączenia i tokena: zalogowany użytkownik (`/rest/api/2/myself`). Finałowy test `/jira-setup` ("Zalogowano jako X").                                                |
| `get_project_config`  | `project`, `board_id?`                                                                                | Metadane projektu pod profil (§5.1): boardy, kolumny→statusy, komponenty, typy zadań, auto-detekcja pola Epic Link. Zaplecze skilla `/jira-config`.                              |

### 4.2 Zapis (faza 2 — za flagą)

| Narzędzie          | Parametry                                                                                               | Opis                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `create_issue`     | `project`, `issue_type`, `summary`, `description`, `components[]`, `labels[]`, `assignee?`, `epic_key?`, `sprint_id?`, `allow_duplicate?` | Tworzy JEDEN ticket. Zwraca klucz + URL. `sprint_id` (z `get_active_sprint`) umieszcza ticket w sprincie — bez niego ląduje w backlogu; pole Sprint/Epic Link z profilu lub auto-detekcji. |
| `add_comment`      | `key`, `body`                                                                                           | Dodaje komentarz.                                                                                                         |
| `transition_issue` | `key`, `transition_name`                                                                                | Zmiana statusu (najpierw pobierz dostępne przejścia, dopasuj po nazwie case-insensitive, przy braku — wylistuj dostępne). |
| `assign_to_epic`   | `epic_key`, `keys[]` (zakresy `PROJ-98..111`, max 20)                                                   | Przypina istniejące zadania do epica (Agile API). Use case analityka: „stories z release'a bez epica → podepnij pod epic". Każde zadanie liczy się do budżetu sesji; wszystkie dotknięte projekty muszą mieć zgodę na zapis. |

**Zasada bezpieczeństwa zapisu:** narzędzia zapisu są rejestrowane w serwerze TYLKO gdy
`JIRA_ALLOW_WRITE=true` w konfiguracji. Domyślnie serwer jest read-only.

**Bezpieczniki zapisu (egzekwowane w kodzie serwera, nie w instrukcjach skilli):**

1. **Jeden ticket na wywołanie** — `create_issue` nie przyjmuje tablic; masowe tworzenie
   wymaga wielu jawnych, widocznych wywołań.
2. **Budżet zapisu na sesję** — licznik w procesie serwera: domyślnie 10× `create_issue`
   i 30 operacji zapisu łącznie. Po przekroczeniu każda operacja zwraca czytelną odmowę
   (reset = restart serwera / `/reload-plugins`). Konfiguracja: pole `writeBudget`
   (`{"creates": n, "total": m}`) lub env `JIRA_WRITE_BUDGET_CREATES` /
   `JIRA_WRITE_BUDGET_TOTAL`. Cel: twardy stop dla niekontrolowanej pętli tworzenia.
3. **Strażnik duplikatów** — przed utworzeniem `create_issue` szuka otwartego zadania
   o tym samym (znormalizowanym) tytule w projekcie; trafienie ⇒ odmowa ze wskazaniem
   istniejącego klucza, chyba że jawnie przekazano `allow_duplicate=true` (wyłącznie po
   potwierdzeniu przez użytkownika).
4. **Bezpiecznik per projekt (opt-in)** — nawet w trybie zapisu projekt jest zapisywalny
   TYLKO gdy jego profil ma `"allowWrite": true` (sekcja `projects.KEY`) albo klucz widnieje
   w `writeProjects` / env `JIRA_WRITE_PROJECTS`. Sprawdzane przy każdym wywołaniu (zmiana
   działa bez restartu); projekt bez jawnej zgody pozostaje read-only. `/jira-setup` pyta
   o tryb pracy (read-only/zapis) globalnie, `/jira-config` pyta o zgodę per projekt.
5. **Globalna flaga sprawdzana też per wywołanie** — rejestracja narzędzi dzieje się przy
   starcie serwera, więc wyłączenie `allowWrite` w configu odcina zapis natychmiast, nawet
   zanim ktoś zrobi `/reload-plugins` (narzędzia mogą być jeszcze widoczne, ale każda
   operacja zwraca odmowę).
6. **Hook chroniący bezpieczniki** (`hooks/hooks.json` + `hooks/guard-config.mjs`,
   dystrybuowane w pluginie) — PreToolUse na Edit/Write/MultiEdit/Bash: każda operacja,
   która zmieniłaby wartość `allowWrite` (globalną lub per projekt) w
   `~/.config/jira-tools/config.json`, wymusza ręczne potwierdzenie człowieka
   (`permissionDecision: "ask"`). Edycje są symulowane i porównywane wartościami, więc
   trik `"false"→"true"` bez słowa "allowWrite" też jest łapany. Ograniczenie platformy:
   w trybach auto/bypassPermissions prompt nie wystąpi.

**Oznaczanie treści AI (transparentność, nie bezpiecznik):** przy `aiLabel: true`
(domyślne; pyta o to `/jira-setup`, env `JIRA_AI_LABEL`) `create_issue` dokłada w kodzie
labelkę `ai-generated` (filtrowalna: `labels = ai-generated`), a `add_comment` dokleja
stały podpis `_(ai-generated · jira-tools)_` — komentarzy Jira nie labelkuje.

### 4.3 Wymagania wspólne

- **Paginacja:** `search_issues` obsługuje `startAt`; przy obcięciu wyników dopisz na końcu
  `"(pokazano X z Y — zawęź JQL lub zwiększ max_results)"`.
- **Oszczędność kontekstu:** domyślnie pobieraj minimalny zestaw pól; `description` i
  `comment` tylko w `get_issue`.
- **Błędy:** 401 → komunikat "token wygasł/nieprawidłowy + jak wygenerować nowy PAT";
  404 → "nie znaleziono KEY"; inne → status + pierwsze 300 znaków body. Nigdy nie loguj tokena.
- **Timeout:** 30 s na request, czytelny komunikat przy przekroczeniu.

## 5. Konfiguracja

Kolejność ładowania (pierwsze wygrane):

1. Zmienne środowiskowe: `JIRA_SERVER`, `JIRA_TOKEN`, `JIRA_ALLOW_WRITE`, `JIRA_DEFAULT_PROJECT`, `JIRA_LANG`.
2. Plik `~/.config/jira-tools/config.json` (prawa 600 przy zapisie).
3. Brak → serwer startuje, ale każde narzędzie zwraca instrukcję: "uruchom /jira-tools:jira-setup".

`JIRA_LANG` (`pl`/`en`) — język generowanych opisów/AC przy tworzeniu ticketów. Nie wpływa na odczyt.

**Token nigdy nie trafia do repo.** `.gitignore` ma obejmować wszelkie pliki config/env.

### 5.1 Profile projektów (per użytkownik)

Każdy użytkownik konfiguruje własne projekty — nie ma globalnego defaulta w repo.
`config.json` zawiera sekcję `projects`: profil per projekt, wypełniany automatycznie przez
skill `/jira-config <projekt>` (§6). Narzędzia i skille czytają profil zamiast zgadywać
nazwy statusów i pól:

```json
{
  "server": "https://jira.example.pl",
  "token": "…",
  "language": "pl",
  "allowWrite": false,
  "defaultProject": "DC",
  "projects": {
    "DC": {
      "boardId": 123,
      "boardName": "DC board",
      "statuses": ["To Do", "To Fix", "In Progress", "Code Review", "Dev Done", "On Hold", "Ready for QA", "QA", "Done"],
      "epicLinkField": "customfield_XXXXX",
      "sprintField": "customfield_XXXXX",
      "platforms": ["iOS", "Android", "Web", "Backend"],
      "titleConvention": "[<Platforma>] <tytuł>",
      "taskTemplate": {
        "bug": "Kroki reprodukcji:\n1. …\n\nOczekiwane:\n…\n\nFaktyczne:\n…",
        "story": "Kontekst biznesowy:\n…\n\nKryteria akceptacji:\n- …",
        "task": "Kontekst:\n…\n\nZakres:\n…\n\nDefinition of Done:\n- …"
      },
      "components": ["Frontend", "Backend"],
      "issueTypes": ["Story", "Bug", "Task", "Sub-task"]
    }
  }
}
```

Gdy profilu brak, obowiązuje domyślna lista statusów (wzorzec, do nadpisania przez profil):
`To Do`, `To Fix`, `In Progress`, `Code Review`, `Dev Done`, `On Hold`, `Ready for QA`,
`QA`, `Done`. Dodatkowy fallback przy nietypowych nazwach: wbudowane `statusCategory`
z Jiry (`new` / `indeterminate` / `done`).

## 6. Skille (slash commands)

Każdy skill = katalog z `SKILL.md` (frontmatter: `name`, `description` — opis ma być
konkretny, bo od niego zależy auto-wywoływanie przez model).

- **`/jira-setup`** — interaktywna konfiguracja: pyta o URL Jiry, prowadzi przez wygenerowanie
  PAT (Profil → Personal Access Tokens), pyta o język (pl/en), domyślny projekt, zapisuje
  do `~/.config/jira-tools/config.json` (chmod 600), na końcu test: `GET /rest/api/2/myself`
  i wypisuje "Zalogowano jako X".
- **`/jira-config <projekt>`** — pobiera metadane projektu i zapisuje profil do configu
  użytkownika (§5.1): boardy projektu (`/rest/agile/1.0/board?projectKeyOrId=`), kolumny →
  statusy z konfiguracji boardu (`/rest/agile/1.0/board/{id}/configuration`), statusy per typ
  zadania (`/rest/api/2/project/{key}/statuses`), komponenty i typy zadań
  (`/rest/api/2/project/{key}`), auto-detekcja pola Epic Link (`/rest/api/2/field`, pole
  o nazwie "Epic Link"). Przy wielu boardach pyta użytkownika, który jest domyślny.
  Na końcu wypisuje podsumowanie zapisanego profilu.
- **`/get-tasks <projekt> [sprint] [tags:a,b,c]`** — moje taski w projekcie; z sprintem —
  zawężone do sprintu; z tagami — filtr po labels. Pod spodem `search_issues` z JQL typu
  `project = X AND assignee = currentUser() AND sprint = "..." AND labels in (...) ORDER BY status`.
- **`/sprint-health [board]`** — raport aktywnego sprintu, sekcje:
  (a) taski bez ruchu ≥3 dni robocze (poza To Do i Done — użyj changelog/updated),
  (b) nie-Done z nowymi komentarzami z ostatnich 3 dni + 1-zdaniowe podsumowanie każdego,
  (c) przeniesione do On Hold + ostatni komentarz,
  (d) braki higieny: bez opisu / labels / komponentu,
  (e) co przeszło na Done wczoraj.
  Dni robocze = pon–pt, świąt nie uwzględniamy (np. w poniedziałek "3 dni robocze wstecz"
  sięga do piątku, czwartku i środy). Nazwy statusów bierz z profilu projektu (§5.1).
- **`/check-stories <projekt> [sprint]`** — audyt user stories: brak przypisanego sprintu
  lub brak numeru azurowego w tytule (domyślny regex `\[\d{6,}\]` — 6+ cyfr, np.
  `[642321] Missing parameters in the event…`; nadpisywalny per projekt polem
  `storyNumberPattern` w profilu). Nawiasy niepasujące do wzorca — `[F]`, `[iOS]`, `[2024]` —
  nie liczą się jako numer i są raportowane osobno; poprawności numeru w Azure nie
  walidujemy. Działa też na jawnej liście kluczy (np. zakres release'a z Notion).
  Wynik: tabela KEY | problem.
- **`/find-bug <opis słowny>`** — wyszukiwanie semantyczne: wyciągnij 2-4 słowa kluczowe
  (PL i EN!), `search_issues` z `text ~` po każdym wariancie, zbierz kandydatów, oceń
  dopasowanie, dla najlepszego podaj status + na jakim środowisku (fixVersions/labels/komentarze)
  - link. Gdy brak pewnego trafienia — pokaż top 3 kandydatów z zastrzeżeniem. Obsłuż też
    wariant "czy taki bug już istnieje?" (deduplikacja) i "wypisz otwarte bugi dotyczące X
    w kolumnach To Do/In Progress/Code Review".
- **`/feedback [opis]`** — mini-wywiad o pomysł/problem z pluginem (co, po co, jak boli,
  przykład) → gotowa wiadomość do wklejenia na Slacka dla opiekunów pluginu; opcjonalnie
  ticket przez `create_issue` (pełny dry-run, bez wyjątków). Skill niczego sam nie wysyła.
**Złota zasada skilli zapisu** (`/create-task`, `/feedback`): agent **strukturyzuje to, co
podał użytkownik, i dopytuje o braki — nigdy nie wymyśla treści**. Pusta sekcja szablonu to
sygnał do zadania pytania (i delikatnego przyciśnięcia), a nie do wypełnienia domysłem;
świadomie pominięta sekcja dostaje dosłownie `(do uzupełnienia)`. Szablon istnieje po to,
by wymusić myślenie użytkownika, nie by dać agentowi miejsce na halucynacje.

Szablony opisu (`taskTemplate` per typ) konfiguruje `/jira-config` na trzy sposoby:
**import ze wskazanych ticketów wzorcowych** (zalecane — np. `BUG - PROJ-99, TASK - PROJ-100`;
skill czyta je przez `get_issue` i wyprowadza strukturę sekcji w stylu zespołu), własny
wklejony szablon albo propozycja skilla.

- **`/create-task <opis>`** — (faza 2) tworzy tickety per platforma. Z opisu case'u generuje:
  tytuł, opis, acceptance criteria (w języku z configu), komponent per platforma
  (iOS/Android/Web/Backend → osobne tickety). **OBOWIĄZKOWY dry-run:** najpierw wypisz
  wszystkie tickety do utworzenia w formie podglądu, czekaj na potwierdzenie użytkownika,
  dopiero potem wywołuj `create_issue`.

## 7. Zasady implementacji (jakość)

- Node `node:test` do testów, żadnych frameworków.
- Klient HTTP: jedna funkcja `jiraFetch(path, opts)` — auth, timeout, mapowanie błędów w jednym miejscu.
- Kod i komentarze po angielsku; komunikaty dla użytkownika końcowego wg `JIRA_LANG`.
- JSDoc na eksportowanych funkcjach.
- Żadnego `console.log` w serwerze MCP na stdout (stdout = protokół!). Debug tylko na stderr,
  za flagą `JIRA_DEBUG=1`.
- `plugin.json`: name `jira-tools`, semver od `0.1.0`, opis, autor.

## 8. Testy

### 8.1 Unit (`npm test`)

Mock `globalThis.fetch`. Pokryj:

- ekspansję zakresów kluczy (`PROJ-98..111`, `PROJ-98..PROJ-111`, pojedyncze, mieszane),
- budowanie JQL przez helpery,
- mapowanie błędów (401/404/500/timeout),
- formatowanie kompaktowe (snapshot na przykładowym JSON-ie ticketa),
- config: precedencja env > plik > brak,
- to, że narzędzia zapisu NIE są zarejestrowane bez `JIRA_ALLOW_WRITE`.

### 8.2 Integracyjne (opt-in, read-only)

Uruchamiane tylko gdy ustawione `JIRA_TEST_SERVER` + `JIRA_TEST_TOKEN`
(`npm run test:integration`). Wyłącznie odczyt: `myself`, `search` z prostym JQL,
`get_issue` na istniejącym kluczu podanym w `JIRA_TEST_ISSUE`. Zero tworzenia/modyfikacji.

Środowisko testowe (sandbox): projekt `DC` — board "DC board", sprint "DC Sprint 1",
przykładowe klucze `DC-1`, `DC-16`, `DC-18` (np. `JIRA_TEST_ISSUE=DC-16`). W projekcie DC
wolno wykonywać manualne testy zapisu (Faza 2); testy automatyczne pozostają read-only.

### 8.3 Test manualny end-to-end (checklist w README)

1. `claude` w dowolnym katalogu → `/plugin marketplace add /ścieżka/do/tego/repo`
2. `/plugin install jira-tools@<nazwa-marketplace>`
3. `/jira-tools:jira-setup` → przejść konfigurację → zobaczyć "Zalogowano jako…"
4. `/mcp` → serwer `jira` widoczny i connected
5. `/get-tasks <PROJEKT>` → zwraca moje taski
6. pytanie naturalnym językiem: "które moje taski w `PROJEKT` zmieniły status wczoraj?"
7. `/sprint-health` → raport z pięcioma sekcjami
8. po zmianach w kodzie: `/reload-plugins` (SKILL.md łapie się na żywo, .mcp.json wymaga reloadu)

## 9. Fazy

- **Faza 1 (MVP):** config + klient + narzędzia odczytu + skille `/jira-setup`, `/get-tasks`,
  `/sprint-health`, `/check-stories`, `/find-bug` + testy unit + README.
- **Faza 2:** narzędzia zapisu za flagą + `/create-task` z dry-runem.
- **Faza 3 (poza tym repo, osobna decyzja):** integracja Notion→Jira, wykorzystanie
  serwera przez PM w Claude Desktop/Cowork (README ma zawierać sekcję konfiguracji
  dla Claude Desktop z przykładowym wpisem `mcpServers`).
- **Sprint 3 (zrealizowany):** hook chroniący bezpieczniki (§4.2 p.6), oznaczanie treści
  AI (§4.2), szablony per typ zadania (§5.1), skill `/feedback` (§6), tryb kompaktowy
  `get_issue` (§4.1).
- **Backlog:** research praktyk zespołów AI-first (wynik: raport z rekomendacjami, nie
  kod); Notion→Jira po uzyskaniu dostępu do Notion MCP (konfiguracja, nie development).
- **Odrzucone/odłożone bez terminu:** pamięć kontekstu tasków (źródłem prawdy jest Jira,
  lokalny cache dryfuje; wraca tylko z konkretnymi scenariuszami użycia).

## 10. Definition of Done

- `npm test` zielony; `claude plugin validate` bez błędów.
- Pełna checklista 8.3 przechodzi na czystej instalacji.
- README wystarcza nowemu członkowi zespołu do samodzielnej instalacji w <10 minut.
- **Anonimizacja:** grep po repo nie znajduje żadnego tokena, hasła, firmowego URL-a
  produkcyjnego ani danych firmowych — nazwy firmy, produkcyjnych kluczy projektów,
  nazw produktów, wewnętrznych nazw branchy. W przykładach używamy neutralnych `PROJ-n`
  i `https://jira.example.pl`. Jedyne dopuszczalne realne identyfikatory to sandbox
  testowy `DC` ("DC board", "DC Sprint 1") — używany tylko do czasu pierwszych instalacji.
  Dane firmowe wchodzą wyłącznie przez lokalny config użytkownika / pliki args (gitignore).
