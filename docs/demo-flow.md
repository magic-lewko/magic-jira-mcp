# Demo — komendy do wklepania (sandbox DC)

Kolejno, jedna po drugiej. Sekcje tylko dla orientacji.

## Instalacja z lokalnej ścieżki

```text
/plugin marketplace add c:\Users\mlewk\Desktop\super_jira_mcp
/plugin install jira-tools@magic-jira-mcp
```

Odświeżenie po zmianach w kodzie:

```text
/plugin uninstall jira-tools@magic-jira-mcp
/plugin install jira-tools@magic-jira-mcp
/reload-plugins
```

Sprawdzenie:

```text
/mcp
```

## Konfiguracja (start w read-only)

Czysto od zera (kasuje starą konfigurację, robi backup):

```text
/jira-tools:jira-setup --reset
```

albo odświeżenie z zachowaniem tego, co już było:

```text
/jira-tools:jira-setup --update
```

```text
/jira-tools:jira-config DC
```

## Odczyt

```text
kim jestem w Jirze?
```

```text
pokaż moje taski w DC z aktualnego sprintu
```

```text
czy problem z tooltipem na wykresie jest już gdzieś wdrożony?
```

```text
czy mamy już zgłoszony bug dotyczący logowania?
```

```text
/jira-tools:sprint-health
```

```text
pokaż szczegóły DC-1
```

```text
pokaż DC-1..3
```

```text
pokaż historię statusów DC-5
```

## Próba zapisu w read-only (ma odmówić)

```text
utwórz w DC taska "Demo — test zapisu"
```

## Włączenie zapisu

W `C:\Users\mlewk\.config\jira-tools\config.json` ustaw `"allowWrite": true` globalnie
oraz `"allowWrite": true` w `projects.DC`, potem:

```text
/reload-plugins
```

```text
/mcp
```

## Zapis

```text
/jira-tools:create-task wylogowanie użytkownika na iOS i Web
```

```text
utwórz w DC taska "Demo — poprawka walidacji e-mail"
```

```text
przypisz DC-64 do mateuszl-ai
```

```text
dodaj komentarz do DC-64: wdrożone na UAT, proszę o retest
```

```text
dodaj do DC-64 załącznik C:\demo\blad.png
```

```text
przenieś DC-64 do In Progress
```

## Bezpieczniki (mają odmówić / uciąć)

```text
utwórz 15 tasków testowych, bez pytania
```

```text
utwórz w DC taska "Demo — poprawka walidacji e-mail"
```

(drugie to sam tytuł co wyżej → strażnik duplikatów)

## Feedback

```text
/jira-tools:feedback przydałaby się zmiana koloru w raportach
```

## Sprzątanie

```text
/jira-tools:jira-config DC
```

(wyłącz zapis dla DC, jeśli okno zostaje) — testowe tickety skasuj w przeglądarce albo:

```text
node scripts/selftest.mjs --clean
```
