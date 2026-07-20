# jira-tools — ściąga

Jira ↔ Claude. Piszesz po ludzku, dostajesz odpowiedź z Jiry.
`PROJ` = klucz Twojego projektu. Komendy `/…` działają w Claude Code; **prompty działają wszędzie** (też w Claude Desktop).

## Zanim zaczniesz (obie grupy)

| Potrzebujesz | Skąd wziąć |
| --- | --- |
| Node.js ≥ 20 | sprawdź: `node -v` w terminalu; brak → [nodejs.org](https://nodejs.org) (LTS) |
| dostęp do Jiry | otwórz Jirę w przeglądarce (VPN, jeśli wymagany) |
| token PAT | Jira → **awatar (prawy górny róg)** → **Personal Access Tokens** → **Create token** — skopiuj od razu, pokaże się tylko raz |

## Instalacja — dev (Claude Code, ~5 min)

```text
/plugin marketplace add https://github.com/magic-lewko/magic-jira-mcp
/plugin install jira-tools@magic-jira-mcp
/jira-tools:jira-setup
```

Setup poprowadzi Cię przez URL, token, język i tryb pracy — na końcu „**Zalogowano jako …**".
Potem raz na projekt:

```text
/jira-tools:jira-config TWÓJPROJEKT
```

## Instalacja — PM / analityk (Claude Desktop, ~10 min)

1. Pobierz pliki pluginu w stałe miejsce, np. `C:\narzedzia\magic-jira-mcp`:
   `git clone https://github.com/magic-lewko/magic-jira-mcp.git` (albo ZIP: Code → Download ZIP)
2. Claude Desktop → **Settings → Developer → Edit Config** → dopisz (popraw ścieżkę — ukośniki `/` — oraz URL i token):

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

3. Zrestartuj Claude Desktop (całkiem zamknij i otwórz)
4. Test: zapytaj **„kim jestem w Jirze?"** → „Zalogowano jako …" = działa

Domyślnie wszystko jest **tylko do odczytu**. Najczęstsze potknięcia: `\` zamiast `/` w ścieżce · brak restartu · brak Node (`node -v`) · wygasły token.

## Odczyt — co chcesz wiedzieć?

| Chcesz… | Wpisz |
| --- | --- |
| swoje zadania | `pokaż moje taski w PROJ z aktualnego sprintu` |
| szczegóły ticketa | `pokaż szczegóły PROJ-42` |
| kilka ticketów naraz | `pokaż PROJ-98..111` |
| kto i kiedy zmieniał status | `pokaż historię statusów PROJ-42` |
| aktywny sprint | `jaki jest aktywny sprint w PROJ?` |
| zadania sprintu | `wypisz zadania z aktualnego sprintu w PROJ` |
| **raport sprintu** ⭐ | `/jira-tools:sprint-health` |
| status epica | `jaki jest status epica PROJ-40?` |
| audyt user stories (sprint / numer `[642321]` w tytule) | `/jira-tools:check-stories PROJ` |
| **czy bug jest naprawiony / na jakim środowisku** ⭐ | `czy problem z licznikami powiadomień jest już na UAT?` |
| czy bug już zgłoszony (zanim założysz) | `czy mamy już zgłoszony bug dotyczący sharingu?` |
| przegląd otwartych bugów o X | `wypisz otwarte bugi dotyczące sharingu i streść każdy` |
| cokolwiek innego | pytaj wprost: `co przeszło na Done wczoraj?` · `taski Kowalskiego bez ruchu od tygodnia` |

Raport sprintu = 5 sekcji: bez ruchu ≥3 dni · świeże komentarze w niedokończonych · On Hold + powód · braki opisu/etykiet/komponentu · Done wczoraj.

## Zapis — tworzenie i zmiany (wymaga włączenia)

Włączasz raz: tryb zapisu w `/jira-setup` + zgoda dla projektu w `/jira-config`. Bez tego Jira jest nietykalna.

| Chcesz… | Wpisz |
| --- | --- |
| **tickety per platforma z opisu** ⭐ | `/jira-tools:create-task wylogowanie użytkownika na iOS i Web` |
| pojedynczy ticket | `utwórz w PROJ taska "Poprawka walidacji e-mail"` |
| komentarz | `dodaj komentarz do PROJ-42: wdrożone na UAT, proszę o retest` |
| zmiana statusu | `przenieś PROJ-42 do In Progress` |
| przypięcie stories do epica | `stories PROJ-101, PROJ-105..110 bez epica podepnij pod epic PROJ-200` |

Przy tworzeniu zawsze: **podgląd → Twoje potwierdzenie → dopiero zapis** (+ wybór: sprint czy backlog). Bez potwierdzenia nic nie powstanie.
Tickety od agenta dostają labelkę `ai-generated` (filtr w JQL: `labels = ai-generated`), a komentarze podpis — zawsze widać, co wygenerowało AI.

## Dlaczego czasem odmówi? (celowo)

- projekt bez zgody na zapis → odmowa,
- tytuł identyczny z otwartym ticketem → odmowa + wskazanie istniejącego,
- limit sesji: 10 utworzeń / 30 zapisów → twardy stop (ochrona przed pętlą),
- zawsze 1 ticket na operację — tworzenia hurtem nie ma.

## Coś nie działa?

| Objaw | Ratunek |
| --- | --- |
| „Jira nie jest skonfigurowana" | `/jira-tools:jira-setup` |
| 401 / token wygasł | nowy PAT (awatar → Personal Access Tokens) → `/jira-tools:jira-setup` |
| timeout | VPN |
| brak narzędzi zapisu mimo włączenia | `/reload-plugins` |
| dziwna kolejność statusów w raportach | `/jira-tools:jira-config PROJ` → wybierz właściwy board |

Masz pomysł na ulepszenie pluginu? **`/jira-tools:feedback`** — krótki wywiad i gotowa wiadomość do wklejenia na Slacka.
