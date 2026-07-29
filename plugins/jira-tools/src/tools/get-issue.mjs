import { z } from 'zod'
import { expandKeys, JiraError } from '../jira-client.mjs'
import { formatIssuesFull } from '../format.mjs'

/** Hard cap so an accidental huge range cannot flood the context. */
const MAX_KEYS = 20

/** Full detail of one or more issues, with PROJ-98..111 range support. */
export default {
  name: 'get_issue',
  config: {
    title: 'Get issue detail',
    description: 'Full detail of one or more issues: description, comments (author + date), '
      + 'attachments (names + URLs), components, labels, fixVersions, epic/parent. '
      + 'Accepts single keys and inclusive ranges: "PROJ-98..111" or "PROJ-98..PROJ-111". '
      + `Max ${MAX_KEYS} issues per call.`,
    inputSchema: {
      key: z.string().optional().describe('Single issue key or range, e.g. "PROJ-42" or "PROJ-98..111"'),
      keys: z.array(z.string()).optional().describe('Multiple keys and/or ranges'),
      all_comments: z.boolean().optional()
        .describe('Return ALL comments and the full description (default: last 5 comments, description capped — saves context on big tickets)'),
    },
  },

  /**
   * @param {{key?: string, keys?: string[]}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ key, keys, all_comments }, { config, client }) {
    const expanded = expandKeys([key, ...(keys ?? [])].filter(Boolean))
    if (expanded.length === 0) {
      throw new JiraError('Provide an issue key in "key" or a list in "keys" (ranges supported: PROJ-98..111).')
    }
    if (expanded.length > MAX_KEYS) {
      throw new JiraError(`Too many issues at once (${expanded.length}, limit ${MAX_KEYS}). Narrow the range or split into several calls.`)
    }

    const results = await Promise.allSettled(expanded.map((k) => client.getIssue(config, k)))
    const issues = []
    const errors = []
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') issues.push(r.value)
      else errors.push(`! ${expanded[i]}: ${r.reason?.message ?? r.reason}`)
    })

    const parts = []
    if (issues.length) parts.push(formatIssuesFull(issues, { server: config.server, full: all_comments === true }))
    if (errors.length) parts.push(errors.join('\n'))
    return parts.join('\n\n')
  },
}
