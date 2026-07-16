/**
 * @fileoverview Server-side safety rails for write operations (SPEC §4.2).
 *
 * Two independent guards, both enforced in CODE (a skill's instructions can be
 * ignored by a model — this cannot):
 *
 * 1. Session write budget — a per-process counter. Once exhausted, every write
 *    fails until the server is restarted (/reload-plugins). This is the hard
 *    stop for runaway loops mass-creating issues.
 * 2. Duplicate guard — refuses to create an issue whose normalized summary
 *    matches an existing open issue in the same project, unless the caller
 *    explicitly passes allow_duplicate. A loop recreating the same ticket dies
 *    on its second call.
 * 3. Per-project write opt-in — even with JIRA_ALLOW_WRITE=true, a project is
 *    writable ONLY when its profile says `allowWrite: true` (or it appears in
 *    `writeProjects` / env JIRA_WRITE_PROJECTS). Production projects stay
 *    untouchable until someone consciously opts them in. Checked per call, so
 *    no server restart is needed to change it.
 */

import { debug, JiraError } from './jira-client.mjs'

/** Defaults when config carries no writeBudget (SPEC §4.2). */
export const DEFAULT_WRITE_BUDGET = { creates: 10, total: 30 }

const counters = { creates: 0, total: 0 }

/** Reset the session counters — tests only. */
export function resetWriteBudget() {
  counters.creates = 0
  counters.total = 0
}

/**
 * Consume one unit of the session write budget or throw a user-facing error.
 * Call it immediately BEFORE the actual write request.
 *
 * @param {{writeBudget?: {creates?: number, total?: number}}} config
 * @param {'create'|'write'} kind - 'create' counts against both limits
 */
export function consumeWriteBudget(config, kind) {
  const budget = { ...DEFAULT_WRITE_BUDGET, ...config?.writeBudget }

  const refuse = (used, limit, what) => {
    throw new JiraError(
      `Limit zapisów w tej sesji osiągnięty (${used}/${limit} — ${what}). `
      + 'To zabezpieczenie przed niekontrolowaną pętlą tworzenia. Jeśli działasz celowo, '
      + 'zrestartuj serwer (/reload-plugins w Claude Code) i kontynuuj, albo podnieś limit '
      + '(config "writeBudget" lub env JIRA_WRITE_BUDGET_CREATES / JIRA_WRITE_BUDGET_TOTAL).',
    )
  }

  if (counters.total >= budget.total) refuse(counters.total, budget.total, 'wszystkie operacje zapisu')
  if (kind === 'create' && counters.creates >= budget.creates) {
    refuse(counters.creates, budget.creates, 'tworzenie zadań')
  }

  counters.total += 1
  if (kind === 'create') counters.creates += 1
}

/**
 * Throw unless the project has been explicitly opted in for writes
 * (profile `allowWrite: true`, config `writeProjects`, or env
 * JIRA_WRITE_PROJECTS). Read per call — editing the config takes effect
 * immediately, no restart.
 *
 * @param {object} config
 * @param {string} projectKey - e.g. 'PROJ' (or derived from an issue key)
 */
export function assertProjectWritable(config, projectKey) {
  // Global flag re-checked PER CALL: registration happens at server startup,
  // so flipping allowWrite to false in the config must take effect immediately
  // even while the old server process is still running.
  if (config?.allowWrite !== true) {
    throw new JiraError(
      'Tryb zapisu jest wyłączony (allowWrite: false) — operacja odrzucona. '
      + 'Jeśli narzędzia zapisu są nadal widoczne, serwer działa na starej konfiguracji: /reload-plugins.',
    )
  }

  const key = String(projectKey).trim().toUpperCase()
  const profileAllows = config?.projects?.[key]?.allowWrite === true
  const listAllows = (config?.writeProjects ?? []).includes(key)
  if (profileAllows || listAllows) return
  throw new JiraError(
    `Zapis do projektu ${key} nie jest włączony — to bezpiecznik per projekt. `
    + `Aby świadomie go włączyć, dopisz "allowWrite": true w sekcji projects.${key} `
    + 'pliku ~/.config/jira-tools/config.json (działa od razu, bez restartu) '
    + `albo ustaw env JIRA_WRITE_PROJECTS=${key}.`,
  )
}

/**
 * Normalize a summary for duplicate comparison: case- and whitespace-insensitive.
 *
 * @param {string} summary
 * @returns {string}
 */
function normalizeSummary(summary) {
  return String(summary ?? '').toLowerCase().replaceAll(/\s+/g, ' ').trim()
}

/**
 * Build a safe JQL text operand from a summary. Jira parses `summary ~ "..."`
 * with Lucene, where special characters break the query even inside quotes
 * (e.g. "[" starts a range query → HTTP 400). They are replaced with spaces —
 * no precision is lost, because the definitive comparison happens in code on
 * the returned candidates, not in JQL.
 *
 * @param {string} summary
 * @returns {string}
 */
function jqlTextOperand(summary) {
  return String(summary)
    .replaceAll(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
}

/**
 * Find an existing OPEN issue in the project whose summary matches (after
 * normalization). Returns the issue or null. Best-effort: when the check
 * itself fails (exotic Jira quirks), creation proceeds — the session budget
 * remains the hard rail.
 *
 * @param {object} config
 * @param {{searchIssues: Function}} client - injected for testability
 * @param {string} project - project key (uppercase)
 * @param {string} summary - candidate summary
 * @returns {Promise<object|null>}
 */
export async function findDuplicate(config, client, project, summary) {
  const wanted = normalizeSummary(summary)
  if (!wanted) return null
  const operand = jqlTextOperand(summary)
  if (!operand) return null
  const jql = `project = ${project} AND summary ~ "${operand}" AND statusCategory != Done`
  try {
    const page = await client.searchIssues(config, { jql, maxResults: 20 })
    return page.issues.find((issue) => normalizeSummary(issue.fields?.summary) === wanted) ?? null
  } catch (err) {
    debug('duplicate check failed, proceeding without it:', err?.message)
    return null
  }
}
