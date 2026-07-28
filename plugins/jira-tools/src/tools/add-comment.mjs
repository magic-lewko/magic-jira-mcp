import { z } from 'zod'
import { consumeWriteBudget } from '../write-guard.mjs'

/** WRITE tool. Registered only behind JIRA_ALLOW_WRITE=true. */
export default {
  name: 'add_comment',
  config: {
    title: 'Add comment (WRITE)',
    description: 'Add ONE comment to a Jira issue. Counts against the per-session write budget.',
    inputSchema: {
      key: z.string().describe('Issue key, e.g. "PROJ-42"'),
      body: z.string().min(1).describe('Comment text'),
    },
  },

  /**
   * @param {{key: string, body: string}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ key, body }, { config, client }) {
    const issueKey = key.trim().toUpperCase()
    consumeWriteBudget(config, 'write')
    // Jira cannot label comments — AI transparency lands as a constant signature (always on).
    const text = `${body}\n\n_(ai-generated · jira-tools)_`
    await client.addComment(config, issueKey, text)
    return `Dodano komentarz do ${issueKey} — ${config.server}/browse/${issueKey}`
  },
}
