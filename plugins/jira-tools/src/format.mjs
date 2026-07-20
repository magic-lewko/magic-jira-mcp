/**
 * @fileoverview Compact, LLM-friendly text formatting of Jira entities.
 *
 * Tools return these strings verbatim (SPEC §4: concise text, never raw JSON).
 * Layouts follow the proven reference scripts (references/jira_show.mjs,
 * references/jira_list.mjs). User-facing strings are Polish per SPEC §4.3.
 */

const SEPARATOR = '─'.repeat(60)

/** Context economy (SPEC §4.3): default caps for get_issue output. */
const COMMENT_LIMIT = 5
const DESCRIPTION_LIMIT = 4000

/**
 * ISO timestamp → YYYY-MM-DD (Jira dates are ISO with offset).
 *
 * @param {string|undefined} iso
 * @returns {string}
 */
function day(iso) {
  return iso ? String(iso).slice(0, 10) : '?'
}

/**
 * One compact line per issue: key, status, type, priority, title, assignee,
 * labels, updated (field set of SPEC §4.1).
 *
 * @param {object} issue - raw Jira issue with LIST_FIELDS
 * @returns {string}
 */
export function formatIssueLine(issue) {
  const f = issue.fields ?? {}
  const parts = [
    `${issue.key} [${f.status?.name ?? '?'}]`,
    `${f.issuetype?.name ?? '?'}/${f.priority?.name ?? '?'}`,
    `— ${f.summary ?? '(bez tytułu)'}`,
    `· ${f.assignee?.displayName ?? 'Nieprzypisany'}`,
  ]
  if ((f.labels ?? []).length) parts.push(`· labels: ${f.labels.join(',')}`)
  if (f.updated) parts.push(`· upd: ${day(f.updated)}`)
  return parts.join(' ')
}

/**
 * A list of issues plus the mandatory truncation note when not all results
 * are shown (SPEC §4.3).
 *
 * @param {{issues: object[], total: number, startAt?: number}} page
 * @returns {string}
 */
export function formatIssueList({ issues, total, startAt = 0 }) {
  if (issues.length === 0) return 'Brak wyników.'
  const lines = issues.map(formatIssueLine)
  const shown = startAt + issues.length
  if (shown < total) {
    lines.push(`(pokazano ${shown} z ${total} — zawęź JQL lub zwiększ max_results)`)
  }
  return lines.join('\n')
}

/**
 * Description block, capped unless `full` (context economy).
 *
 * @param {object} fields
 * @param {boolean} full
 * @returns {string[]}
 */
function descriptionBlock(fields, full) {
  let description = (fields.description ?? '(brak opisu)').trim() || '(brak opisu)'
  if (!full && description.length > DESCRIPTION_LIMIT) {
    description = `${description.slice(0, DESCRIPTION_LIMIT)}\n… (opis przycięty — pełna treść: all_comments=true)`
  }
  return ['', 'OPIS:', description]
}

/**
 * Attachments block (names + URLs), empty array when none.
 *
 * @param {object} fields
 * @returns {string[]}
 */
function attachmentsBlock(fields) {
  const atts = fields.attachment ?? []
  if (atts.length === 0) return []
  return ['', `ZAŁĄCZNIKI (${atts.length}):`, ...atts.map((a) => `- ${a.filename}  ${a.content}`)]
}

/**
 * Comments block — by default only the COMMENT_LIMIT most recent ones, with
 * an explicit truncation note; `full` lifts the cap.
 *
 * @param {object} fields
 * @param {boolean} full
 * @returns {string[]}
 */
function commentsBlock(fields, full) {
  const comments = fields.comment?.comments ?? []
  if (comments.length === 0) return []
  const shown = full || comments.length <= COMMENT_LIMIT ? comments : comments.slice(-COMMENT_LIMIT)
  const header = shown.length === comments.length
    ? `KOMENTARZE (${comments.length}):`
    : `KOMENTARZE (pokazano ${shown.length} ostatnich z ${comments.length} — pełna lista: all_comments=true):`
  const lines = ['', header]
  for (const c of shown) {
    lines.push(
      `• ${c.author?.displayName ?? '?'} (${day(c.created)}):`,
      `  ${(c.body ?? '').trim().replaceAll('\n', '\n  ')}`,
    )
  }
  return lines
}

/**
 * Full single-issue detail: header, meta, description, attachments, comments
 * (layout proven in references/jira_show.mjs) + browse URL.
 *
 * Context economy: by default the description is capped and only the most
 * recent comments are rendered (with explicit notes); `full: true` (tool param
 * all_comments) lifts both caps.
 *
 * @param {object} issue - raw Jira issue with DETAIL_FIELDS
 * @param {{server?: string, full?: boolean}} [opts]
 * @returns {string}
 */
export function formatIssueFull(issue, { server, full = false } = {}) {
  const f = issue.fields ?? {}
  const out = [
    `${issue.key} — ${f.summary ?? '(bez tytułu)'}`,
    `${f.issuetype?.name ?? '?'} · ${f.priority?.name ?? '?'} · ${f.status?.name ?? '?'}`
    + ` · ${f.assignee?.displayName ?? 'Nieprzypisany'}`
    + ` · zgłosił: ${f.reporter?.displayName ?? '?'}`,
  ]

  const meta = []
  if ((f.components ?? []).length) meta.push(`komponenty: ${f.components.map((c) => c.name).join(', ')}`)
  if ((f.labels ?? []).length) meta.push(`labels: ${f.labels.join(', ')}`)
  if ((f.fixVersions ?? []).length) meta.push(`fixVersions: ${f.fixVersions.map((v) => v.name).join(', ')}`)
  if (f.parent) meta.push(`parent/epic: ${f.parent.key} (${f.parent.fields?.summary ?? '?'})`)
  meta.push(`utworzono: ${day(f.created)}, aktualizacja: ${day(f.updated)}`)
  out.push(meta.join(' · '))

  if (server) out.push(`${server}/browse/${issue.key}`)
  out.push(...descriptionBlock(f, full), ...attachmentsBlock(f), ...commentsBlock(f, full))
  return out.join('\n')
}

/**
 * Several issues in full detail, separated visually.
 *
 * @param {object[]} issues
 * @param {{server?: string, full?: boolean}} [opts]
 * @returns {string}
 */
export function formatIssuesFull(issues, opts = {}) {
  return issues.map((i) => formatIssueFull(i, opts)).join(`\n${SEPARATOR}\n`)
}

/**
 * Sprint header: name, state, dates, goal.
 *
 * @param {object} sprint - Agile API sprint object
 * @returns {string}
 */
export function formatSprint(sprint) {
  const lines = [`Sprint: ${sprint.name} (${sprint.state}, id: ${sprint.id})`]
  lines.push(`Daty: ${day(sprint.startDate)} → ${day(sprint.endDate)}`)
  if (sprint.goal) lines.push(`Cel: ${sprint.goal}`)
  return lines.join('\n')
}

/**
 * Board list, one line each.
 *
 * @param {object[]} boards - Agile API board objects
 * @returns {string}
 */
export function formatBoards(boards) {
  if (boards.length === 0) return 'Brak boardów.'
  return boards
    .map((b) => {
      const project = b.location?.projectKey ? `, projekt: ${b.location.projectKey}` : ''
      return `${b.id} — ${b.name} (${b.type}${project})`
    })
    .join('\n')
}

/**
 * Status-change history extracted from an expanded changelog: date, author,
 * from → to. Non-status items are skipped.
 *
 * @param {object} issue - issue fetched with expand=changelog
 * @returns {string}
 */
export function formatChangelog(issue) {
  const histories = issue.changelog?.histories ?? []
  const lines = []
  for (const h of histories) {
    for (const item of h.items ?? []) {
      if (item.field !== 'status') continue
      lines.push(`${day(h.created)}  ${item.fromString ?? '?'} → ${item.toString ?? '?'}  (${h.author?.displayName ?? '?'})`)
    }
  }
  if (lines.length === 0) return `${issue.key}: brak zmian statusu w historii.`
  return [`${issue.key} — historia statusów:`, ...lines].join('\n')
}

/**
 * Epic roll-up: per-status counts + the list of not-done children.
 * "Open" means Jira statusCategory !== done.
 *
 * @param {string} epicKey
 * @param {{issues: object[], total: number}} result
 * @returns {string}
 */
export function formatEpicStatus(epicKey, { issues, total }) {
  if (issues.length === 0) return `Epic ${epicKey}: brak zadań podpiętych.`

  const counts = new Map()
  for (const issue of issues) {
    const status = issue.fields?.status?.name ?? '?'
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  const open = issues.filter((i) => i.fields?.status?.statusCategory?.key !== 'done')

  const ofTotal = issues.length < total ? ` (z ${total})` : ''
  const out = [`Epic ${epicKey} — ${issues.length} zadań${ofTotal}:`]
  for (const [status, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    out.push(`  ${String(n).padStart(3)}  ${status}`)
  }
  if (open.length) {
    out.push('', `Otwarte (${open.length}):`)
    for (const issue of open) out.push(formatIssueLine(issue))
  } else {
    out.push('', 'Wszystkie zadania zamknięte.')
  }
  return out.join('\n')
}
