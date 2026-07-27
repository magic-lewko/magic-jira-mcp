# Brief prezentacji — wklej to do Claude, żeby wygenerować slajdy

> Skopiuj CAŁĄ zawartość poniżej (od linii „ZADANIE") i wklej do Claude
> (np. przez artefakt HTML/slajdy albo „wygeneruj prezentację"). To jest
> jednocześnie instrukcja dla generatora i pełna treść wystąpienia.

---

ZADANIE: Wygeneruj profesjonalną prezentację (14 slajdów) przedstawiającą zespołowi
wewnętrzne narzędzie — plugin integrujący Jirę z Claude przez MCP. Publiczność jest
mieszana: developerzy oraz PM/analitycy. Cel: wyjaśnić czym jest MCP, pokazać co narzędzie
potrafi, i przekonać, że oparcie go o deterministyczne reguły w kodzie (a nie „ufamy, że AI
się zachowa") czyni je bezpiecznym i rozwijalnym.

WYMAGANIA DOTYCZĄCE FORMY:
- Format: samodzielna prezentacja (slajdy). Jeśli to artefakt — czysty, nowoczesny,
  ciemne tło z jednym kolorem akcentu, dużo powietrza, maksymalnie kilka punktów na slajd.
- Ton: konkretny, bez korpo-waty. Krótkie zdania. Jeden kluczowy komunikat na slajd.
- Ikony/emoji dozwolone oszczędnie jako akcenty sekcji.
- Każdy slajd: wyraźny nagłówek + treść w punktach (nie akapity). Notatki prelegenta
  opcjonalnie pod slajdem.
- Język: polski. Terminy techniczne zostaw po angielsku (MCP, read-only, dry-run).

TREŚĆ SLAJDÓW:

### Slajd 1 — Tytuł
- **Jira × Claude — integracja przez MCP**
- Podtytuł: Jeden serwer, wielu użytkowników. Rozmawiasz z Jirą po ludzku.
- Stopka: wewnętrzne narzędzie zespołu · wersja demonstracyjna

### Slajd 2 — Problem, który rozwiązujemy
- Ciągłe przełączanie: praca ↔ przeglądarka ↔ Jira.
- „Czy bug z licznikiem powiadomień jest już na UAT?" — klient pyta, Ty klikasz 10 minut.
- Sprint się rozjeżdża: co utknęło, co bez opisu, co przeszło na Done — nikt nie ma czasu sprawdzać.
- Zakładanie ticketów per platforma (iOS/Android/Web/Backend) to ręczna, powtarzalna mordęga.
- Notatka prelegenta: to nie są problemy „techniczne" — to codzienne tarcie PM-a, analityka i developera.

### Slajd 3 — Co to jest MCP (w jednym zdaniu)
- **MCP = uniwersalny port dla AI.** Tak jak USB-C: jeden standard, podłączasz cokolwiek.
- Piszesz JEDEN serwer (tu: nasza Jira) — a każdy klient AI potrafi z niego korzystać.
- Serwer wystawia „narzędzia" (np. „wyszukaj zgłoszenia", „utwórz ticket"), a model sam decyduje, kiedy ich użyć.
- Notatka prelegenta: kluczowa zmiana myślenia — nie budujemy kolejnej apki z UI, budujemy zdolności, których AI używa w naturalnej rozmowie.

### Slajd 4 — Idea reużywalności
- Napisane raz — działa wszędzie:
  - **Developer** w Claude Code (terminal / VS Code) — komendy i naturalny język.
  - **PM / analityk** w Claude Desktop — sam naturalny język, zero terminala.
- Ten sam serwer, różni odbiorcy, zero duplikacji kodu.
- Bonus: **kompozycja** — nasz serwer Jiry można zestawić z innymi (np. Notion), a AI połączy je w jednym poleceniu.
- Notatka prelegenta: to jest przewaga MCP nad „botem do Jiry" — nie jesteśmy zamknięci w jednej aplikacji.

### Slajd 5 — Jak to wygląda w praktyce (odczyt)
- „pokaż moje taski w PROJ z aktualnego sprintu"
- „**czy problem z licznikami powiadomień jest już na UAT?**" — znajduje buga, podaje status i środowisko.
- „czy mamy już zgłoszony bug o sharingu?" — deduplikacja, zanim ktoś założy piąty raz to samo.
- „raport zdrowia sprintu" — 5 sekcji: bez ruchu ≥3 dni, świeże komentarze, On Hold, braki higieny, Done wczoraj.
- Notatka prelegenta: pokaż na żywo find-bug i sprint-health, jeśli jest dostęp.

### Slajd 6 — Jak to wygląda w praktyce (zapis)
- „**załóż taski na wylogowanie — iOS i Web**" → osobne tickety per platforma, z opisem i kryteriami akceptacji.
- „przypisz PROJ-42 do jkowalski", „dodaj komentarz", „przenieś do In Progress".
- „stories z release'a bez epica podepnij pod epic PROJ-200".
- Załączniki (screenshoty) i aktualizacja pól istniejących zgłoszeń.
- Zasada żelazna: **podgląd → Twoje potwierdzenie → dopiero zapis.**

### Slajd 7 — Serce: deterministyczne reguły (nie ufamy — wymuszamy)
- Bezpieczeństwo jest w KODZIE serwera, nie w promptcie. Prompt można zignorować, kodu nie.
- **Read-only domyślnie.** Zapis trzeba świadomie włączyć — globalnie i osobno per projekt.
- **Budżet sesji** — twardy limit (np. 10 utworzeń). Agent nie zrobi 180 tasków w pętli, choćby chciał.
- **Strażnik duplikatów**, **jeden ticket na wywołanie**, **hook chroniący ustawienia** (AI nie włączy sobie zapisu samo).
- Notatka prelegenta: to jest odpowiedź na obawę „a jak AI coś nabroi" — nabroić się nie da, bo reguły są twarde.

### Slajd 8 — Rozbudowa reguł = rozbudowa zaufania
- Reguły to zwykły, testowalny kod — dokładamy je jak klocki.
- Chcesz, żeby w projekcie X nie dało się ruszać ticketów po Code Review? To reguła.
- Chcesz wymusić numer z Azure w tytule story? Już jest (`[123456]`).
- Chcesz oznaczać wszystko, co stworzyła AI? Jest labelka `ai-generated` — dokładana twardo w kodzie.
- Przesłanie: **im więcej reguł, tym więcej możemy pozwolić AI zrobić bez nadzoru.**

### Slajd 9 — Transparentność AI
- Każdy ticket utworzony przez agenta dostaje etykietę **`ai-generated`** (filtrowalną w JQL).
- Komentarze od AI dostają krótki podpis.
- Zawsze wiadomo, co dodał człowiek, a co wygenerował model — bez zgadywania.
- Notatka prelegenta: to buduje zaufanie audytowe — nic się nie „przemyca" do Jiry anonimowo.

### Slajd 10 — Instalacja: dwie ścieżki, < 10 minut
- **Developer (Claude Code):** dodaj źródło → zainstaluj → `jira-setup`. Trzy komendy.
- **PM / analityk (Claude Desktop):** wklej jeden wpis konfiguracyjny → restart → „kim jestem w Jirze?".
- Token zostaje lokalnie u Ciebie, nigdy w repozytorium.
- Domyślnie tryb tylko do odczytu — pierwsze starcie z tablicą jest bezpieczne.

### Slajd 11 — To żyje i rośnie z Waszych potrzeb
- Wbudowana komenda **`/feedback`**: krótki wywiad → gotowa wiadomość na Slacka.
- Realny przykład: analityczka zgłosiła brak zmiany assignee i załączników → **dodane tego samego dnia.**
- Pętla: używacie → zgłaszacie → narzędzie rośnie. Bez formularzy, bez czekania na „następny sprint".
- Notatka prelegenta: to nie jest zamknięty produkt — to platforma, którą wspólnie kształtujemy.

### Slajd 12 — Jakość, której nie widać, ale jest
- ~86 testów jednostkowych + self-test odpalany na żywej tablicy sandboxowej.
- Jeden przycisk „sprawdź, czy wszystko gra" — zamiast klikania po kolei.
- Self-test sam po sobie sprząta (tworzy i kasuje testowe tickety).
- Przesłanie: to nie prototyp na kolanie — to narzędzie, któremu można zaufać w codziennej pracy.

### Slajd 13 — Co dalej (roadmap)
- **Notion → Jira**: generowanie ticketów prosto ze stron Notion (gdy podepniemy Notion MCP).
- Szablony ticketów per typ i per projekt — spójne zgłoszenia w całym zespole.
- Więcej reguł per projekt — dopasowanych do procesu każdego zespołu.
- Wysyłka wklejonych zrzutów ekranu wprost z rozmowy.

### Slajd 14 — Wezwanie do działania
- Zainstaluj (ściąga i instrukcja są gotowe).
- Zacznij od odczytu — zapytaj o swój sprint albo o buga po opisie.
- Masz pomysł lub coś boli? **`/feedback`** — i lecimy dalej.
- Hasło zamykające: **Mniej klikania. Więcej robienia. Jira, która rozumie, o co pytasz.**

---

WSKAZÓWKA DLA GENERATORA: jeśli tworzysz artefakt HTML — zrób nawigację strzałkami/klawiszami,
responsywnie, jeden akcent kolorystyczny, czytelną typografię. Nie dodawaj treści spoza tego
briefu ani nie wymyślaj liczb; jeśli czegoś brakuje, zostaw miejsce na uzupełnienie.
