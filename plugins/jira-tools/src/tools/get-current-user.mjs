/**
 * Setup verification: who am I? (GET /rest/api/2/myself, SPEC §6 jira-setup).
 */
export default {
  name: 'get_current_user',
  config: {
    title: 'Get current user',
    description: 'Verify the connection and token: returns the authenticated Jira user. '
      + 'Used by /jira-tools:jira-setup as the final "Zalogowano jako X" check.',
    inputSchema: {},
  },

  /**
   * @param {object} _args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run(_args, { config, client }) {
    const me = await client.getMyself(config)
    const id = me.name ?? me.emailAddress
    return `Zalogowano jako ${me.displayName ?? id}${id ? ` (${id})` : ''} — ${config.server}`
  },
}
