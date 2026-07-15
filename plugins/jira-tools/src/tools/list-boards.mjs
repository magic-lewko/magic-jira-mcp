import { z } from 'zod'
import { formatBoards } from '../format.mjs'

/** Agile boards — the entry point for finding sprints. */
export default {
  name: 'list_boards',
  config: {
    title: 'List Agile boards',
    description: 'List Agile boards (id, name, type, project), optionally filtered by project key. '
      + 'Use the board id with get_active_sprint / get_sprint_issues.',
    inputSchema: {
      project: z.string().optional().describe('Project key filter, e.g. "PROJ"'),
    },
  },

  /**
   * @param {{project?: string}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ project }, { config, client }) {
    const boards = await client.listBoards(config, { project })
    return formatBoards(boards)
  },
}
