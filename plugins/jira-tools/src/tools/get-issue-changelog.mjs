import { z } from 'zod'
import { formatChangelog } from '../format.mjs'

/** Status-change history — basis for "what moved to Done yesterday" etc. */
export default {
  name: 'get_issue_changelog',
  config: {
    title: 'Get issue status history',
    description: 'Status-change history of an issue with dates and authors '
      + '(who moved it, from what, to what, when). '
      + 'Use for questions like "what changed status yesterday" or "stuck for 3 days".',
    inputSchema: {
      key: z.string().describe('Issue key, e.g. "PROJ-42"'),
    },
  },

  /**
   * @param {{key: string}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ key }, { config, client }) {
    const issue = await client.getIssue(config, key.trim().toUpperCase(), {
      fields: ['summary', 'status'],
      expand: 'changelog',
    })
    return formatChangelog(issue)
  },
}
