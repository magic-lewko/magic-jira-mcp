import { z } from 'zod'
import { expandKeys, JiraError } from '../jira-client.mjs'
import { consumeWriteBudget } from '../write-guard.mjs'

/** Hard cap per call — Agile API allows 50, we stay far below on purpose. */
const MAX_KEYS = 20

/**
 * WRITE tool. Registered only behind JIRA_ALLOW_WRITE=true.
 * Assigns existing issues to an epic (the analyst's release flow: "stories
 * without an epic → link them to the release epic"). Every affected project
 * must be opted in for writes; each issue counts against the session budget.
 */
export default {
  name: 'assign_to_epic',
  config: {
    title: 'Assign issues to epic (WRITE)',
    description: 'Link existing issues to an epic (Agile API). Accepts keys and inclusive '
      + `ranges ("PROJ-98..111"), max ${MAX_KEYS} per call. Present the resolved list to the `
      + 'user for confirmation BEFORE calling. Each assigned issue counts against the '
      + 'per-session write budget; all affected projects must have writes enabled.',
    inputSchema: {
      epic_key: z.string().describe('Target epic key, e.g. "PROJ-200"'),
      keys: z.array(z.string()).min(1)
        .describe('Issue keys and/or ranges to assign, e.g. ["PROJ-101", "PROJ-105..110"]'),
    },
  },

  /**
   * @param {{epic_key: string, keys: string[]}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ epic_key, keys }, { config, client }) {
    const epic = epic_key.trim().toUpperCase()
    const expanded = expandKeys(keys)
    if (expanded.length === 0) {
      throw new JiraError('Provide at least one issue key (ranges supported: PROJ-98..111).')
    }
    if (expanded.length > MAX_KEYS) {
      throw new JiraError(`Too many issues at once (${expanded.length}, limit ${MAX_KEYS}). Split into smaller batches.`)
    }

    for (let i = 0; i < expanded.length; i++) consumeWriteBudget(config, 'write')

    await client.addIssuesToEpic(config, epic, expanded)
    return `Linked ${expanded.length} issues to epic ${epic}: ${expanded.join(', ')} — ${config.server}/browse/${epic}`
  },
}
