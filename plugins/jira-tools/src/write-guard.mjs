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
 */

import { JiraError } from './jira-client.mjs'

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
  const budget = { ...DEFAULT_WRITE_BUDGET, ...(config?.writeBudget ?? {}) }

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
 * Normalize a summary for duplicate comparison: case- and whitespace-insensitive.
 *
 * @param {string} summary
 * @returns {string}
 */
function normalizeSummary(summary) {
  return String(summary ?? '').toLowerCase().replaceAll(/\s+/g, ' ').trim()
}

/**
 * Escape a string for use inside a quoted JQL text operand.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeJql(text) {
  return text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

/**
 * Find an existing OPEN issue in the project whose summary matches (after
 * normalization). Returns the issue or null.
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
  const jql = `project = ${project} AND summary ~ "${escapeJql(summary.trim())}" AND statusCategory != Done`
  const page = await client.searchIssues(config, { jql, maxResults: 20 })
  return page.issues.find((issue) => normalizeSummary(issue.fields?.summary) === wanted) ?? null
}
