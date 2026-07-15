import { z } from 'zod'
import { LIST_FIELDS } from '../jira-client.mjs'
import { formatIssueList } from '../format.mjs'

/**
 * Foundation tool: run arbitrary JQL. Claude composes the JQL itself for
 * natural-language questions (SPEC §4.1).
 */
export default {
  name: 'search_issues',
  config: {
    title: 'Search issues (JQL)',
    description: 'Run any JQL query against Jira and get a compact issue list '
      + '(key, status, type, priority, title, assignee, labels, updated). '
      + 'Foundation for all natural-language questions — compose the JQL yourself, e.g. '
      + '\'project = PROJ AND assignee = currentUser() AND sprint in openSprints() ORDER BY status\' '
      + 'or \'project = PROJ AND status changed to Done after -1d\'.',
    inputSchema: {
      jql: z.string().min(1).describe('JQL query (Jira Server syntax)'),
      max_results: z.number().int().min(1).max(100).optional()
        .describe('Maximum issues to return (default 30, max 100)'),
      fields: z.array(z.string()).optional()
        .describe('Extra Jira field ids to fetch beyond the compact default set (e.g. "duedate", "customfield_10008")'),
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
    const extras = (fields ?? []).filter((f) => !LIST_FIELDS.includes(f))
    const page = await client.searchIssues(config, {
      jql,
      maxResults: max_results ?? 30,
      startAt: start_at ?? 0,
      ...(extras.length ? { fields: [...LIST_FIELDS, ...extras] } : {}),
    })

    let text = formatIssueList(page)
    if (extras.length && page.issues.length) {
      const lines = page.issues.map((issue) => {
        const values = extras.map((f) => `${f}: ${JSON.stringify(issue.fields?.[f] ?? null)}`)
        return `${issue.key} · ${values.join(' · ')}`
      })
      text += `\n\nDodatkowe pola:\n${lines.join('\n')}`
    }
    return text
  },
}
