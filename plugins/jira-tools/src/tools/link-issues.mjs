import { z } from 'zod'
import { expandKeys, JiraError } from '../jira-client.mjs'
import { consumeWriteBudget } from '../write-guard.mjs'

/** Cap: linking one source to a handful of targets, not a fan-out storm. */
const MAX_TARGETS = 20

/**
 * WRITE tool. Registered only behind JIRA_ALLOW_WRITE=true.
 *
 * Links one issue to one or more others (reported from production use: platform
 * tickets of one story need a "Relates" link). Link type matched
 * case-insensitively against the instance's types; on miss the available names
 * are listed. Each link counts against the session budget; all touched projects
 * must be write-enabled.
 */
export default {
  name: 'link_issues',
  config: {
    title: 'Link issues (WRITE)',
    description: 'Create a link between issues (e.g. "Relates"). Links `from` to each key in '
      + '`to` (keys and ranges, max ' + MAX_TARGETS + '). `from` is the outward side (for '
      + '"Blocks": from blocks to). When the type name is unknown, returns the available '
      + 'link types. Counts against the per-session write budget.',
    inputSchema: {
      from: z.string().describe('Source issue key, e.g. "PROJ-42"'),
      to: z.array(z.string()).min(1).describe('Target keys and/or ranges to link to'),
      type: z.string().optional().describe('Link type name (default "Relates"), e.g. "Blocks", "Duplicate"'),
    },
  },

  /**
   * @param {{from: string, to: string[], type?: string}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ from, to, type }, { config, client }) {
    const source = from.trim().toUpperCase()
    const targets = expandKeys(to).filter((k) => k !== source)
    if (targets.length === 0) throw new JiraError('Provide at least one target issue (different from the source).')
    if (targets.length > MAX_TARGETS) {
      throw new JiraError(`Too many links at once (${targets.length}, limit ${MAX_TARGETS}).`)
    }

    const wanted = (type ?? 'Relates').trim().toLowerCase()
    const { issueLinkTypes = [] } = await client.listIssueLinkTypes(config)
    const match = issueLinkTypes.find((t) => t.name?.toLowerCase() === wanted)
    if (!match) {
      const names = [...new Set(issueLinkTypes.map((t) => `"${t.name}"`))].join(', ') || '(brak)'
      throw new JiraError(`Unknown link type "${type}". Available: ${names}.`)
    }

    for (let i = 0; i < targets.length; i++) consumeWriteBudget(config, 'write')

    for (const target of targets) {
      await client.linkIssues(config, { type: match.name, from: source, to: target })
    }
    return `Linked ${source} (${match.name}) to: ${targets.join(', ')} — ${config.server}/browse/${source}`
  },
}
