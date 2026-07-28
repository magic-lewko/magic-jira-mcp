import { z } from 'zod'
import { JiraError } from '../jira-client.mjs'
import { consumeWriteBudget } from '../write-guard.mjs'

/**
 * WRITE tool. Registered only behind JIRA_ALLOW_WRITE=true.
 * Fetches available transitions first and matches by name case-insensitively;
 * on miss it lists what IS available (SPEC §4.2).
 */
export default {
  name: 'transition_issue',
  config: {
    title: 'Transition issue (WRITE)',
    description: 'Change the status of ONE issue by transition name (case-insensitive). '
      + 'When the name does not match, returns the list of currently available transitions. '
      + 'Counts against the per-session write budget.',
    inputSchema: {
      key: z.string().describe('Issue key, e.g. "PROJ-42"'),
      transition_name: z.string().describe('Transition name, e.g. "In Progress", "Done"'),
    },
  },

  /**
   * @param {{key: string, transition_name: string}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ key, transition_name }, { config, client }) {
    const issueKey = key.trim().toUpperCase()
    const { transitions = [] } = await client.listTransitions(config, issueKey)

    const wanted = transition_name.trim().toLowerCase()
    const match = transitions.find((t) => t.name?.toLowerCase() === wanted)
    if (!match) {
      const available = transitions.map((t) => `"${t.name}"`).join(', ') || '(brak dostępnych przejść)'
      throw new JiraError(
        `Brak przejścia "${transition_name}" dla ${issueKey}. Dostępne przejścia: ${available}.`,
      )
    }

    consumeWriteBudget(config, 'write')
    await client.doTransition(config, issueKey, match.id)
    const target = match.to?.name ? ` → status: ${match.to.name}` : ''
    return `${issueKey}: wykonano przejście "${match.name}"${target}.`
  },
}
