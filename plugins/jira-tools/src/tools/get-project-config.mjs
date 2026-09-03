import { z } from 'zod'
import { detectIssueTypeRoles } from '../issue-fields.mjs'

/**
 * Gather everything /jira-tools:jira-config needs to build a project profile:
 * boards, board columns → statuses, components, issue types (with a proposed
 * role map) and the auto-detected Epic Link / Sprint / Epic Name / Story
 * Points fields. Returns a ready-to-save JSON profile.
 */

/**
 * Find a custom field by display name, falling back to its schema suffix.
 *
 * @param {object[]} fields - /rest/api/2/field entries
 * @param {string} fieldName - e.g. 'Epic Link'
 * @param {string} customSuffix - e.g. ':gh-epic-link'
 * @returns {object|undefined}
 */
function findCustomField(fields, fieldName, customSuffix) {
  return fields.find((f) => f.name === fieldName)
    ?? fields.find((f) => f.schema?.custom?.endsWith(customSuffix))
}

/**
 * Pick the board to profile. Returns either the board (or null when the
 * project has none) or a user-facing prompt when a choice is required.
 *
 * @param {object[]} boards
 * @param {number|undefined} boardId
 * @param {string} projectKey
 * @returns {{board: object|null}|{prompt: string}}
 */
function selectBoard(boards, boardId, projectKey) {
  if (boardId !== undefined) {
    return { board: boards.find((b) => b.id === boardId) ?? { id: boardId, name: `(board ${boardId})` } }
  }
  if (boards.length === 1) return { board: boards[0] }
  if (boards.length === 0) return { board: null }
  const list = boards.map((b) => `- ${b.id}: ${b.name} (${b.type})`).join('\n')
  return { prompt: `Project ${projectKey} has ${boards.length} boards — call again with board_id to pick the right one:\n${list}` }
}

/**
 * Status names of a board in column order (deduplicated).
 *
 * @param {object} config
 * @param {object} client
 * @param {number} boardId
 * @returns {Promise<string[]>}
 */
async function collectBoardStatuses(config, client, boardId) {
  const [boardConfig, allStatuses] = await Promise.all([
    client.getBoardConfiguration(config, boardId),
    client.listStatuses(config),
  ])
  const statusName = new Map(allStatuses.map((s) => [String(s.id), s.name]))
  const statuses = []
  for (const column of boardConfig.columnConfig?.columns ?? []) {
    for (const s of column.statuses ?? []) {
      const name = statusName.get(String(s.id))
      if (name && !statuses.includes(name)) statuses.push(name)
    }
  }
  return statuses
}

export default {
  name: 'get_project_config',
  config: {
    title: 'Get project configuration',
    description: 'Collect project metadata for a config profile: Agile boards, board columns '
      + 'with their statuses (in column order), components, issue types with a proposed role map '
      + '(epic/story/task/subtask/bug) and the auto-detected Epic Link / Sprint / Epic Name / Story '
      + 'Points field ids. Returns a ready-to-save JSON profile for '
      + '~/.config/jira-tools/config.json. When the project has several boards, call again '
      + 'with board_id to pick one.',
    inputSchema: {
      project: z.string().describe('Project key, e.g. "PROJ"'),
      board_id: z.number().int().optional().describe('Board id to use when the project has several boards'),
    },
  },

  /**
   * @param {{project: string, board_id?: number}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ project, board_id }, { config, client }) {
    const key = project.trim().toUpperCase()
    const [proj, boards, fields] = await Promise.all([
      client.getProject(config, key),
      client.listBoards(config, { project: key }),
      client.listFields(config),
    ])

    const selection = selectBoard(boards, board_id, key)
    if ('prompt' in selection) return selection.prompt
    const { board } = selection

    const statuses = board ? await collectBoardStatuses(config, client, board.id) : []
    const epicField = findCustomField(fields, 'Epic Link', ':gh-epic-link')
    const sprintField = findCustomField(fields, 'Sprint', ':gh-sprint')
    const epicNameField = findCustomField(fields, 'Epic Name', ':gh-epic-label')
    // Story Points: by name only — its custom type is a generic float.
    const storyPointsField = fields.find((f) => f.name === 'Story Points')
    const issueTypes = proj.issueTypes ?? []
    const issueTypeRoles = detectIssueTypeRoles(issueTypes)

    const profile = {
      ...(board ? { boardId: board.id, boardName: board.name } : {}),
      ...(statuses.length ? { statuses } : {}),
      ...(epicField ? { epicLinkField: epicField.id } : {}),
      ...(sprintField ? { sprintField: sprintField.id } : {}),
      ...(epicNameField ? { epicNameField: epicNameField.id } : {}),
      ...(storyPointsField ? { storyPointsField: storyPointsField.id } : {}),
      components: (proj.components ?? []).map((c) => c.name),
      issueTypes: issueTypes.map((t) => t.name),
      ...(Object.keys(issueTypeRoles).length ? { issueTypeRoles } : {}),
    }

    return [
      `Project profile ${key} (${proj.name ?? key}):`,
      board ? `Board: ${board.name} (id ${board.id})` : 'Board: no Agile board found.',
      statuses.length ? `Statuses (column order): ${statuses.join(' → ')}` : 'Statuses: no column configuration.',
      `Epic Link field: ${epicField ? epicField.id : 'not detected'}`,
      `Sprint field: ${sprintField ? sprintField.id : 'not detected'}`,
      `Epic Name field: ${epicNameField ? epicNameField.id : 'not detected'}`,
      `Story Points field: ${storyPointsField ? storyPointsField.id : 'not detected'}`,
      `Issue types: ${issueTypes.map((t) => (t.subtask ? `${t.name} (sub-task)` : t.name)).join(', ') || 'none'}`,
      'Proposed issue type roles: '
        + (Object.keys(issueTypeRoles).length
          ? Object.entries(issueTypeRoles).map(([role, name]) => `${role} → ${name}`).join(', ')
          : 'none detected')
        + ' — confirm or complete the epic/story/task/subtask/bug map in /jira-tools:jira-config.',
      '',
      'Save in ~/.config/jira-tools/config.json under projects.' + key + ':',
      '```json',
      JSON.stringify(profile, null, 2),
      '```',
    ].join('\n')
  },
}
