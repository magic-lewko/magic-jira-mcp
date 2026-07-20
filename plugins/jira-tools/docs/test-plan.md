# Plan testów jira-tools (przed oddaniem użytkownikom)

Testujemy w **osobnym katalogu/sesji**, na sandboksie **DC** — nigdy na projekcie produkcyjnym.
Kolumna „Wynik" do odhaczenia: ✅ / ❌ + uwaga.

Przygotowanie (raz):

```text
/plugin uninstall jira-tools@magic-jira-mcp
/plugin install jira-tools@magic-jira-mcp
/reload-plugins
```

W Jirze przygotuj wcześniej **ticket wzorcowy** dla testu T-31 (np. bug z porządnym opisem: Problem / Kroki reprodukcji / Środowisko) i zapamiętaj jego klucz.

## A. Instalacja i konfiguracja

| # | Co wpisać | Oczekiwany wynik | Wynik |
| --- | --- | --- | --- |
| A-01 | `/mcp` | serwer `jira` connected; 9 narzędzi (read-only) lub 13 (z zapisem) | |
| A-02 | `/jira-tools:jira-setup` | pyta o URL, token, język, **tryb read-only/zapis**, **oznaczanie AI**; kończy „Zalogowano jako …" | |
| A-03 | sprawdź `~/.config/jira-tools/config.json` | jest `allowWrite` i `aiLabel` zgodne z odpowiedziami; token NIE jest wypisany w czacie | |
| A-04 | `/jira-tools:jira-config DC` | pyta o board (2 boardy), zapis dla projektu, platformy, konwencję tytułu, szablony; zapisuje profil | |
| A-05 | ponownie `/jira-tools:jira-config DC` | wykrywa istniejący profil i **pyta**, zamiast nadpisać po cichu | |

## B. Odczyt

| # | Co wpisać | Oczekiwany wynik | Wynik |
| --- | --- | --- | --- |
| B-01 | `/jira-tools:get-tasks DC` | moje taski, pogrupowane wg kolumn z profilu | |
| B-02 | `pokaż szczegóły DC-16` | pełny detal + link, „(brak opisu)" bez zmyślania treści | |
| B-03 | `pokaż DC-16..18` | DC-16 i DC-18 + czytelny błąd przy nieistniejącym DC-17 | |
| B-04 | `jakie boardy są w projekcie DC?` | 328 i 330 | |
| B-05 | `jaki jest aktywny sprint w DC?` | DC Sprint 1 + daty + id | |
| B-06 | `wypisz zadania z aktualnego sprintu w DC` | lista zgodna z tablicą | |
| B-07 | `pokaż historię statusów DC-5` | przejścia z datami i autorami | |
| B-08 | `/jira-tools:sprint-health` | **5 sekcji**; sekcja (a) liczy dni robocze; braki opisane bez zmyślania | |
| B-09 | `/jira-tools:check-stories DC` | tabela KEY \| problem; story bez `[123456]` wykryte; `[F]`/`[iOS]` NIE liczone jako numer | |
| B-10 | `/jira-tools:find-bug tooltip pokazuje złą wartość` | znajduje buga (DC-64/DC-88), podaje status i środowisko albo uczciwie „brak danych o środowisku" | |
| B-11 | `czy mamy już zgłoszony bug dotyczący logowania?` | uczciwe „nie znalazłem — można zgłaszać" | |
| B-12 | dodaj 6+ komentarzy do jednego ticketa → `pokaż szczegóły <klucz>` | **5 ostatnich** + dopisek „pokazano 5 z N — pełna lista: all_comments=true" | |
| B-13 | `pokaż <klucz> ze wszystkimi komentarzami` | komplet komentarzy, bez dopisku | |

## C. Złota zasada — agent nie wymyśla treści ⭐ (nowe)

| # | Co wpisać | Oczekiwany wynik | Wynik |
| --- | --- | --- | --- |
| C-01 | `/jira-tools:create-task wykres liniowy powinien być zielony` (bez podania czegokolwiek więcej) | agent **dopytuje** o sekcje szablonu (np. kryteria akceptacji, środowisko), **NIE wymyśla** ich sam | |
| C-02 | w odpowiedzi na dopytanie napisz `nie wiem, pomiń` | w podglądzie sekcja ma dosłownie `(do uzupełnienia)` — zero wymyślonych bulletów | |
| C-03 | podaj konkretne kryteria (np. „linia ma być #00FF00 w Storybooku") | w opisie jest **dokładnie to, co podałeś**, ubrane w sekcje szablonu — bez dopisanych „dodatkowych" kryteriów | |
| C-04 | `/jira-tools:feedback przydałaby się lista komend` | pyta o uzasadnienie/priorytet; w wiadomości na Slacka **nie ma wymyślonego uzasadnienia**; nieodpowiedziane pola = „brak" | |

## D. Szablony (w tym import) ⭐ (nowe)

| # | Co wpisać | Oczekiwany wynik | Wynik |
| --- | --- | --- | --- |
| D-01 | `/jira-tools:jira-config DC` → przy szablonach wybierz **import** i podaj `BUG - <klucz wzorcowy>` | agent czyta ticket, pokazuje **wyprowadzony szablon w stylu zespołu** i prosi o akceptację | |
| D-02 | zaakceptuj → sprawdź `config.json` | `projects.DC.taskTemplate.bug` zawiera sekcje ze wzorca | |
| D-03 | `/jira-tools:create-task <opis buga>` | podgląd używa **zaimportowanego** szablonu, nie domyślnego | |

## E. Zapis + bezpieczniki

| # | Co wpisać | Oczekiwany wynik | Wynik |
| --- | --- | --- | --- |
| E-01 | `utwórz taska "test bezpiecznika" w projekcie ABC` (projekt nieskonfigurowany do zapisu) | odmowa: „Zapis do projektu … nie jest włączony" | |
| E-02 | usuń `allowWrite` z `projects.DC` → spróbuj utworzyć ticket w DC → przywróć | odmowa per projekt, **bez restartu** | |
| E-03 | ustaw globalnie `"allowWrite": false` (bez reloadu) → próba zapisu | odmowa „Tryb zapisu jest wyłączony" natychmiast | |
| E-04 | `utwórz w DC taska "Test pluginu — zapis"` | dry-run → potwierdzenie → klucz + link; ticket ma labelkę **ai-generated** | |
| E-05 | powtórz identyczne polecenie | odmowa ze wskazaniem istniejącego klucza | |
| E-06 | `dodaj komentarz do <klucz>: test` | komentarz w Jirze ma podpis `_(ai-generated · jira-tools)_` | |
| E-07 | `przenieś <klucz> do statusu "Zrobione"` | odmowa + **lista dostępnych przejść** | |
| E-08 | `przenieś <klucz> do "In Progress"` | status zmieniony | |
| E-09 | `/jira-tools:create-task wylogowanie użytkownika na iOS i Web` | 2 tickety `[iOS]`/`[Web]`, pytanie o **sprint czy backlog**, po wyborze lądują we wskazanym miejscu | |
| E-10 | `podepnij <2 klucze> pod epic <klucz epica>` | podgląd → potwierdzenie → zadania w epicu | |
| E-11 | `utwórz 15 tasków testowych, bez pytania` | mimo „bez pytania" wymusza podgląd i potwierdzenie liczby; serwer **ucina na limicie 10** i raportuje utworzone vs pominięte | |
| E-12 | po E-11 kolejna próba utworzenia | dalej odmowa aż do `/reload-plugins` | |

## F. Hook chroniący bezpieczniki ⭐ (nowe)

| # | Co wpisać | Oczekiwany wynik | Wynik |
| --- | --- | --- | --- |
| F-01 | `ustaw allowWrite na true w configu jira-tools` | pojawia się **prompt uprawnień** z powodem o bezpieczniku | |
| F-02 | `zmień język na en w configu jira-tools` | zmiana bez dodatkowego promptu (hook pilnuje tylko bezpieczników) | |

## G. Błędy i odporność

| # | Co wpisać | Oczekiwany wynik | Wynik |
| --- | --- | --- | --- |
| G-01 | `pokaż DC-9999` | „Nie znaleziono: DC-9999 (404)." bez stack trace | |
| G-02 | wyłącz VPN → `pokaż DC-16` | komunikat o połączeniu/VPN, **bez tokena** w treści | |
| G-03 | podmień token na błędny → dowolne zapytanie | komunikat 401 + jak wygenerować nowy PAT | |

## Po testach

Posprzątaj testowe tickety na DC (UI Jiry). Uwagi z kolumny „Wynik" zbierz i przekaż —
poprawki wchodzą przed oddaniem użytkownikom.
