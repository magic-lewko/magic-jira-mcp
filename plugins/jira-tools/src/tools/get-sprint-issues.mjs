import { z } from 'zod'
import { JiraError } from '../jira-client.mjs'
import { formatIssueList, formatSprint } from '../format.mjs'

/** Sprint issues, addressed by sprint id or by board + sprint name. */
export default {
  name: 'get_sprint_issues',
  config: {
    title: 'Get sprint issues',
    description: 'Compact list of all issues in a sprint. Address the sprint either by sprint_id, '
      + 'or by board_id + sprint_name (name matched case-insensitively).',
    inputSchema: {
      sprint_id: z.number().int().optional().describe('Sprint id (preferred when known)'),
      board_id: z.number().int().optional().describe('Board id — required when using sprint_name'),
      sprint_name: z.string().optional().describe('Sprint name, e.g. "Sprint 12"'),
    },
  },

  /**
   * @param {{sprint_id?: number, board_id?: number, sprint_name?: string}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ sprint_id, board_id, sprint_name }, { config, client }) {
    let sprint = null

    if (sprint_id === undefined) {
      if (board_id === undefined || !sprint_name) {
        throw new JiraError('Provide sprint_id or the board_id + sprint_name pair.')
      }
      const sprints = await client.listSprints(config, board_id)
      const wanted = sprint_name.trim().toLowerCase()
      sprint = sprints.find((s) => s.name?.toLowerCase() === wanted)
        ?? sprints.find((s) => s.name?.toLowerCase().includes(wanted))
      if (!sprint) {
        const names = sprints.map((s) => s.name).join(', ') || '(no sprints)'
        throw new JiraError(`Sprint not found: "${sprint_name}" on board ${board_id}. Available: ${names}.`)
      }
    }

    const id = sprint?.id ?? sprint_id
    const result = await client.getSprintIssues(config, id)
    const header = sprint ? formatSprint(sprint) : `Sprint ${id}`
    return `${header}\n\n${formatIssueList(result)}`
  },
}
