/**
 * Version / health check: which plugin version is actually connected, and is a
 * Jira config loaded? Answers even without a config (alwaysAvailable) so it can
 * settle "old cache vs new version" in any client. Never exposes the token.
 */
import { VERSION } from '../version.mjs'
import { writeBudgetStatus } from '../write-guard.mjs'

export default {
  name: 'get_version',
  // Diagnostic — must answer even when Jira is not configured yet.
  alwaysAvailable: true,
  config: {
    title: 'Get plugin version',
    description: 'Report the running jira-tools MCP server version plus a quick health check: '
      + 'Node version, whether a Jira config is loaded and which server it points at. '
      + 'Use it to confirm exactly which plugin version is connected in this session.',
    inputSchema: {},
  },

  /**
   * @param {object} _args
   * @param {{config: object|null}} ctx
   * @returns {Promise<string>}
   */
  async run(_args, { config }) {
    const lines = [
      `jira-tools MCP server v${VERSION}`,
      `Node ${process.version}`,
    ]
    if (config) {
      lines.push(`Config: loaded — server ${config.server}`)
      if (config.defaultProject) lines.push(`Default project: ${config.defaultProject}`)
      const profiles = Object.keys(config.projects ?? {})
      if (profiles.length) lines.push(`Project profiles: ${profiles.join(', ')}`)
      if (config.language) lines.push(`Language: ${config.language}`)
      const budget = writeBudgetStatus(config)
      lines.push(
        `Write budget this session: ${budget.creates.used}/${budget.creates.limit} creates, `
        + `${budget.total.used}/${budget.total.limit} writes`,
      )
    } else {
      lines.push(
        'Config: NOT loaded — run /jira-tools:jira-setup, '
        + 'or set the Jira URL and token in the Desktop plugin settings.',
      )
    }
    return lines.join('\n')
  },
}
