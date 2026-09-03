import { z } from 'zod'
import { LIST_FIELDS } from '../jira-client.mjs'
import { formatIssueList } from '../format.mjs'

/** Top-level issue properties a caller may request by name (they are not under `fields`). */
const TOP_LEVEL = new Set(['id', 'key', 'self'])

/** Timestamp fields: shown with time of day in the extra block (the compact line keeps the day). */
const DATE_FIELDS = new Set(['created', 'updated', 'resolutiondate', 'lastViewed'])

/**
 * `2026-08-12T14:03:22.000+0200` → `2026-08-12 14:03`; date-only values pass through.
 *
 * @param {string} iso
 * @returns {string}
 */
function timestamp(iso) {
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  return m ? `${m[1]} ${m[2]}` : String(iso)
}

/**
 * Flatten a Jira field value to a short, CSV-friendly string: users → username,
 * named things (status, priority, resolution, type, component) → name, issues →
 * key, select options → value, arrays → comma list. Never the raw JSON with
 * avatar URLs. `undefined` (field not returned) is left for the caller to flag.
 *
 * @param {string} name - field id
 * @param {unknown} value
 * @returns {string|undefined}
 */
function flatten(name, value) {
  if (value === undefined) return undefined
  if (value === null || value === '') return '-'
  if (Array.isArray(value)) return value.map((item) => flatten(name, item)).join(', ') || '-'
  if (typeof value === 'object') {
    const picked = value.name ?? value.displayName ?? value.key ?? value.value
    if (picked === undefined) return JSON.stringify(value)
    return typeof picked === 'object' ? JSON.stringify(picked) : String(picked)
  }
  return DATE_FIELDS.has(name) ? timestamp(value) : String(value)
}

/**
 * @param {object} issue - raw Jira issue
 * @param {string} name - field id or top-level property
 * @returns {unknown}
 */
function readField(issue, name) {
  return TOP_LEVEL.has(name) ? issue[name] : issue.fields?.[name]
}

/**
 * Foundation tool: run arbitrary JQL. Claude composes the JQL itself for
 * natural-language questions (SPEC §4.1). `fields` adds a CSV-friendly
 * "Extra fields" block for report/export use.
 */
export default {
  name: 'search_issues',
  config: {
    title: 'Search issues (JQL)',
    description: 'Run any JQL query against Jira and get a compact issue list '
      + '(key, status, type, priority, title, assignee, labels, updated). '
      + 'Foundation for all natural-language questions — compose the JQL yourself, e.g. '
      + '\'project = PROJ AND assignee = currentUser() AND sprint in openSprints() ORDER BY status\' '
      + 'or \'project = PROJ AND status changed to Done after -1d\'. '
      + 'Pass `fields` for an "Extra fields" block (CSV-style exports): the numeric issue `id`, '
      + '`key`/`self`, `created`/`updated` with time of day, `reporter`/`assignee` as usernames, '
      + '`resolution`/`status`/`priority` as names — objects are flattened, never raw JSON.',
    inputSchema: {
      jql: z.string().min(1).describe('JQL query (Jira Server syntax)'),
      max_results: z.number().int().min(1).max(100).optional()
        .describe('Maximum issues to return (default 30, max 100)'),
      fields: z.array(z.string()).optional()
        .describe('Field ids to add as an "Extra fields" block, e.g. ["id", "created", "reporter", '
          + '"resolution", "customfield_10008"]. Top-level id/key/self work too; created/updated come '
          + 'back with time of day'),
      start_at: z.number().int().min(0).optional()
        .describe('Pagination offset (default 0)'),
    },
  },

  /**
   * @param {{jql: string, max_results?: number, fields?: string[], start_at?: number}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ jql, max_results, fields, start_at }, { config, client }) {
    const requested = [...new Set((fields ?? []).map((f) => f.trim()).filter(Boolean))]
    const jiraFields = requested.filter((f) => !TOP_LEVEL.has(f))
    const page = await client.searchIssues(config, {
      jql,
      maxResults: max_results ?? 30,
      startAt: start_at ?? 0,
      ...(jiraFields.length ? { fields: [...new Set([...LIST_FIELDS, ...jiraFields])] } : {}),
    })

    let text = formatIssueList(page)
    if (requested.length && page.issues.length) {
      const missing = new Set(requested)
      const lines = page.issues.map((issue) => {
        const values = requested.map((name) => {
          const flat = flatten(name, readField(issue, name))
          if (flat !== undefined) missing.delete(name)
          return `${name}: ${flat ?? '?'}`
        })
        return `${issue.key} · ${values.join(' · ')}`
      })
      text += `\n\nExtra fields:\n${lines.join('\n')}`
      if (missing.size) {
        text += `\n(not returned by Jira: ${[...missing].join(', ')} — check the field id)`
      }
    }
    return text
  },
}
