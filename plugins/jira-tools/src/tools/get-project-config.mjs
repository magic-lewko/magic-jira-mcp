import { z } from 'zod'

/**
 * Gather everything /jira-tools:jira-config needs to build a project profile:
 * boards, board columns → statuses, components, issue types and the
 * auto-detected Epic Link / Sprint fields. Returns a ready-to-save JSON profile.
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
  return { prompt: `Projekt ${projectKey} ma ${boards.length} boardów — wywołaj ponownie z board_id, wybierając właściwy:\n${list}` }
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
      + 'with their statuses (in column order), components, issue types and the auto-detected '
      + 'Epic Link / Sprint field ids. Returns a ready-to-save JSON profile for '
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

    const profile = {
      ...(board ? { boardId: board.id, boardName: board.name } : {}),
      ...(statuses.length ? { statuses } : {}),
      ...(epicField ? { epicLinkField: epicField.id } : {}),
      ...(sprintField ? { sprintField: sprintField.id } : {}),
      components: (proj.components ?? []).map((c) => c.name),
      issueTypes: (proj.issueTypes ?? []).map((t) => t.name),
    }

    return [
      `Profil projektu ${key} (${proj.name ?? key}):`,
      board ? `Board: ${board.name} (id ${board.id})` : 'Board: nie znaleziono boardu Agile.',
      statuses.length ? `Statusy (kolejność kolumn): ${statuses.join(' → ')}` : 'Statusy: brak konfiguracji kolumn.',
      `Pole Epic Link: ${epicField ? epicField.id : 'nie wykryto'}`,
      `Pole Sprint: ${sprintField ? sprintField.id : 'nie wykryto'}`,
      '',
      'Do zapisania w ~/.config/jira-tools/config.json pod kluczem projects.' + key + ':',
      '```json',
      JSON.stringify(profile, null, 2),
      '```',
    ].join('\n')
  },
}
