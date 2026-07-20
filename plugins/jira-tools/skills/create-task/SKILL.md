---
name: create-task
description: Create Jira tickets for a described case, one per platform (iOS/Android/Web/Backend), structuring what the USER provided into the project's template - ALWAYS with a dry-run preview and explicit user confirmation before anything is created. Use when the user says "/create-task", "załóż taski na...", "utwórz tickety dla...", "create tickets for this case".
---

Turn the user's case into Jira tickets. Respond in the user's language; ticket content follows the `language` from `~/.config/jira-tools/config.json`. Case: $ARGUMENTS

## ZŁOTA ZASADA — nie wymyślaj treści za użytkownika

Twoim zadaniem jest **ustrukturyzować to, co powiedział użytkownik, i dopytać o braki** — NIE wypełniać ticketa własnymi wymysłami.

- **Nigdy nie zmyślaj** kryteriów akceptacji, kroków reprodukcji, środowiska, zakresu ani „ładniejszego" opisu problemu. Jeśli użytkownik czegoś nie powiedział — tego nie wiesz.
- Sekcja szablonu bez danych od użytkownika = **sygnał, żeby zapytać**, nie żeby ją zapełnić. Szablon istnieje po to, by wymusić myślenie użytkownika.
- Zadaj jedną rundę pytań o braki, wprost i konkretnie, np.: „W szablonie bug jest sekcja *Kryteria akceptacji* — nie podałeś ich. Po czym poznamy, że to jest naprawione?", „Na jakim środowisku to występuje?".
- Możesz **delikatnie przycisnąć** („bez kroków reprodukcji dev będzie zgadywał — masz choć jeden przykład?"), ale gdy użytkownik świadomie pomija sekcję, wstaw dosłownie `(do uzupełnienia)` i zostaw.
- Wolno Ci: przeformułować zdania użytkownika na zwięzły opis, rozbić jeden case na platformy, dobrać tytuł wg konwencji. Nie wolno: dokładać treści merytorycznej, której nie było.

## Hard safety rules — no exceptions

- **NEVER call `create_issue` before the user explicitly confirms the dry-run preview** — also when they say "bez pytania".
- **Create at most the previewed set** — one `create_issue` call per ticket, sequentially.
- **STOP immediately on the first creation error.** Report what was created and what was skipped; never blindly retry (on a retry check `search_issues` first).
- If a server refusal looks like a plugin bug (e.g. malformed-JQL/400), report it and stop — do NOT invent workarounds (renaming conventions, bypass flags) and do NOT persist such workarounds to memory.
- No write tools available → writes are disabled (`allowWrite: false`): tell the user to enable them in the config + `/reload-plugins`. No workarounds.

## Steps

1. **Scope**: project (argument or `defaultProject`), platforms from the profile's `platforms` (fallback: iOS, Android, Web, Backend) — which ones apply comes from the user; when unclear, ask. Map platforms to `components` from the profile; no matching component → create without one and say so. Issue type: ask when not obvious from the case (bug vs task vs story decides which template applies).

2. **Fill the template, not your imagination**: take `projects.<KEY>.taskTemplate.<type>` (when absent: a minimal Opis + Kryteria akceptacji skeleton) and map the user's words onto its sections. Mark every section the user did not cover.

3. **Interview round for the gaps** (skip only when nothing is missing): ask about ALL missing sections in one AskUserQuestion, quoting the section names from the template. Fill in exactly what the user answers; unanswered sections get `(do uzupełnienia)`.

4. **DRY-RUN (mandatory), two parts**:
   - Full preview as a normal chat message — one section per ticket:

     ```markdown
     ### 1/2 · [iOS] Wylogowanie użytkownika
     Typ: Task · Projekt: DC · Komponent: iOS · Labels: — · Epic: — · Sprint: (wg wyboru niżej)

     **Opis (wg szablonu projektu):**
     …
     ```

   - Then AskUserQuestion with a SHORT question (never paste ticket contents into the dialog — it truncates; refer to the preview above): create or not, and sprint placement ("Aktywny sprint «name» czy backlog?").
   - Over **6 tickets** → extra warning with the exact count and a separate confirmation.

5. **Create** after confirmation: one `create_issue` per ticket, in order, with `sprint_id` when the user chose the sprint. Report each returned key + URL. Server rails (per-project opt-in, duplicate guard, write budget) — relay refusals verbatim and STOP; never use `allow_duplicate` unless the user explicitly says the duplicate is intended.

6. **Summary**: created keys with links + where they landed; list anything skipped. If any ticket has `(do uzupełnienia)`, remind the user to fill it in.
