/**
 * @fileoverview Executable entry point: connect the server over stdio.
 * Bundled by scripts/build.mjs into servers/jira-mcp.mjs (self-contained).
 *
 * stdout is reserved for the MCP protocol — any diagnostics go to stderr.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server.mjs'
import { debug } from './jira-client.mjs'

try {
  const server = createServer()
  await server.connect(new StdioServerTransport())
  debug('jira MCP server connected (stdio)')
} catch (err) {
  console.error('[jira-mcp] fatal:', err?.message ?? err)
  process.exit(1)
}
