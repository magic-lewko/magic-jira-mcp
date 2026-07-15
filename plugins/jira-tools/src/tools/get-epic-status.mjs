import { z } from 'zod'
import { formatEpicStatus } from '../format.mjs'

/**
 * Epic roll-up. Primary source: Agile API epic endpoint (no custom field
 * needed). Fallback for setups where that endpoint fails: JQL on the
 * "Epic Link" field name.
 */
export default {
  name: 'get_epic_status',
  config: {
    title: 'Get epic status',
    description: 'Roll-up of an epic: children counted per status + the list of still-open children.',
    inputSchema: {
      epic_key: z.string().describe('Epic issue key, e.g. "PROJ-40"'),
    },
  },

  /**
   * @param {{epic_key: string}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ epic_key }, { config, client }) {
    const key = epic_key.trim().toUpperCase()
    let result
    try {
      result = await client.getEpicIssues(config, key)
    } catch {
      const page = await client.searchIssues(config, { jql: `"Epic Link" = ${key}`, maxResults: 100 })
      result = { issues: page.issues, total: page.total }
    }
    return formatEpicStatus(key, result)
  },
}
