import { z } from 'zod'
import { formatSprint } from '../format.mjs'

/** Active sprint of a board: name, dates, goal. */
export default {
  name: 'get_active_sprint',
  config: {
    title: 'Get active sprint',
    description: 'The active sprint of an Agile board: name, sprint id, start/end dates, goal. '
      + 'Find the board id with list_boards.',
    inputSchema: {
      board_id: z.number().int().describe('Agile board id'),
    },
  },

  /**
   * @param {{board_id: number}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ board_id }, { config, client }) {
    const sprint = await client.getActiveSprint(config, board_id)
    if (!sprint) return `Board ${board_id} has no active sprint.`
    return formatSprint(sprint)
  },
}
