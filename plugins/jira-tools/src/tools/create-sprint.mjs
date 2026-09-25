import { z } from 'zod'
import { JiraError } from '../jira-client.mjs'
import { consumeWriteBudget } from '../write-guard.mjs'

/** Jira Server rejects longer sprint names (verified: 30 accepted, 31 rejected). */
const MAX_NAME_LENGTH = 30

/**
 * WRITE tool. Creates exactly ONE future sprint on a Scrum board — it lands in
 * the backlog; starting it stays a manual decision in Jira. Rails: session
 * budget and a duplicate guard on the name among the board's active and future
 * sprints (allow_duplicate=true only after explicit user confirmation).
 */
export default {
  name: 'create_sprint',
  config: {
    title: 'Create sprint (WRITE)',
    description: 'Create ONE future sprint on a Scrum board (it appears in the backlog and is NOT '
      + 'started). Returns the sprint id to pass as sprint_id to create_issue / update_issue. '
      + `The name is at most ${MAX_NAME_LENGTH} characters (Jira limit). `
      + 'Dates are optional and come together (ISO 8601 date-time, e.g. '
      + '"2026-10-06T09:00:00.000+02:00"). Refuses Kanban boards and refuses when an active or '
      + 'future sprint with the same name already exists on the board, unless allow_duplicate=true. '
      + 'Counts against the per-session write budget.',
    inputSchema: {
      board_id: z.number().int().describe('Scrum board id (from list_boards or the project profile)'),
      name: z.string().min(1).describe('Sprint name, e.g. "Sprint 13"'),
      goal: z.string().optional().describe('Sprint goal'),
      start_date: z.string().optional().describe('Planned start, ISO 8601 date-time; requires end_date'),
      end_date: z.string().optional().describe('Planned end, ISO 8601 date-time; requires start_date'),
      allow_duplicate: z.boolean().optional()
        .describe('Create even though a sprint with this name exists — only after the user explicitly confirmed it'),
    },
  },

  /**
   * @param {{board_id: number, name: string, goal?: string, start_date?: string, end_date?: string, allow_duplicate?: boolean}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ board_id, name, goal, start_date, end_date, allow_duplicate }, { config, client }) {
    const sprintName = name.trim()
    if (!sprintName) throw new JiraError('Sprint name must not be empty.')
    if (sprintName.length > MAX_NAME_LENGTH) {
      throw new JiraError(
        `Sprint name is too long (${sprintName.length} characters, Jira allows ${MAX_NAME_LENGTH}). Shorten it.`,
      )
    }

    if ((start_date === undefined) !== (end_date === undefined)) {
      throw new JiraError('Provide start_date and end_date together, or neither.')
    }
    if (start_date !== undefined) {
      const start = Date.parse(start_date)
      const end = Date.parse(end_date)
      if (Number.isNaN(start) || Number.isNaN(end)) {
        throw new JiraError('start_date and end_date must be ISO 8601 date-times, e.g. "2026-10-06T09:00:00.000+02:00".')
      }
      if (end <= start) throw new JiraError('end_date must be after start_date.')
    }

    const board = await client.getBoard(config, board_id)
    const boardType = String(board?.type ?? '').toLowerCase()
    if (boardType && boardType !== 'scrum') {
      throw new JiraError(
        `Board ${board_id} ("${board.name}") is a ${boardType} board — sprints exist only on Scrum boards.`,
      )
    }

    if (!allow_duplicate) {
      const sprints = await client.listSprints(config, board_id, { state: 'active,future' })
      const wanted = sprintName.toLowerCase()
      const duplicate = sprints.find((s) => String(s.name ?? '').trim().toLowerCase() === wanted)
      if (duplicate) {
        throw new JiraError(
          `Not created — board ${board_id} already has a ${duplicate.state} sprint named "${duplicate.name}" `
          + `(id ${duplicate.id}). If a second one is intended and the user confirmed it, call again with `
          + 'allow_duplicate=true.',
        )
      }
    }

    consumeWriteBudget(config, 'write')
    const sprint = await client.createSprint(config, {
      boardId: board_id, name: sprintName, goal, startDate: start_date, endDate: end_date,
    })
    return `Created sprint "${sprint.name}" (id ${sprint.id}, ${sprint.state}) on board ${board_id} — `
      + `${config.server}/secure/RapidBoard.jspa?rapidView=${board_id}&view=planning`
  },
}
