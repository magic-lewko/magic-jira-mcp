import { z } from 'zod'

/**
 * Gather everything /jira-tools:jira-config needs to build a project profile:
 * boards, board columns → statuses, components, issue types and the
 * auto-detected Epic Link field. Returns a ready-to-save JSON profile.
 */
export default {
  name: 'get_project_config',
  config: {
    title: 'Get project configuration',
    description: 'Collect project metadata for a config profile: Agile boards, board columns '
      + 'with their statuses (in column order), components, issue types and the auto-detected '
      + 'Epic Link field id. Returns a ready-to-save JSON profile for ~/.config/jira-tools/config.json. '
      + 'When the project has several boards, call again with board_id to pick one.',
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

    let board = null
    if (board_id !== undefined) {
      board = boards.find((b) => b.id === board_id) ?? { id: board_id, name: `(board ${board_id})` }
    } else if (boards.length === 1) {
      board = boards[0]
    } else if (boards.length > 1) {
      const list = boards.map((b) => `- ${b.id}: ${b.name} (${b.type})`).join('\n')
      return `Projekt ${key} ma ${boards.length} boardów — wywołaj ponownie z board_id, wybierając właściwy:\n${list}`
    }

    let statuses = []
    if (board) {
      const [boardConfig, allStatuses] = await Promise.all([
        client.getBoardConfiguration(config, board.id),
        client.listStatuses(config),
      ])
      const statusName = new Map(allStatuses.map((s) => [String(s.id), s.name]))
      for (const column of boardConfig.columnConfig?.columns ?? []) {
        for (const s of column.statuses ?? []) {
          const name = statusName.get(String(s.id))
          if (name && !statuses.includes(name)) statuses.push(name)
        }
      }
    }

    const epicField = fields.find((f) => f.name === 'Epic Link')
      ?? fields.find((f) => f.schema?.custom?.endsWith(':gh-epic-link'))

    const profile = {
      ...(board ? { boardId: board.id, boardName: board.name } : {}),
      ...(statuses.length ? { statuses } : {}),
      ...(epicField ? { epicLinkField: epicField.id } : {}),
      components: (proj.components ?? []).map((c) => c.name),
      issueTypes: (proj.issueTypes ?? []).map((t) => t.name),
    }

    return [
      `Profil projektu ${key} (${proj.name ?? key}):`,
      board ? `Board: ${board.name} (id ${board.id})` : 'Board: nie znaleziono boardu Agile.',
      statuses.length ? `Statusy (kolejność kolumn): ${statuses.join(' → ')}` : 'Statusy: brak konfiguracji kolumn.',
      `Pole Epic Link: ${epicField ? epicField.id : 'nie wykryto'}`,
      '',
      'Do zapisania w ~/.config/jira-tools/config.json pod kluczem projects.' + key + ':',
      '```json',
      JSON.stringify(profile, null, 2),
      '```',
    ].join('\n')
  },
}
