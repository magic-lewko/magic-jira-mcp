/**
 * @fileoverview Executable entry point: connect the server over stdio.
 * Bundled by scripts/build.mjs into servers/jira-mcp.mjs (self-contained).
 *
 * stdout is reserved for the MCP protocol — any diagnostics go to stderr.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server.mjs'
import { debug } from './jira-client.mjs'
import { VERSION } from './version.mjs'

// Plain CLI version query: `node jira-mcp.mjs --version`. It exits BEFORE the
// stdio transport is opened, so this is the one path where a stdout write is
// safe — the MCP protocol stream never starts here.
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  process.stdout.write(`jira-tools ${VERSION}\n`)
  process.exit(0)
}

try {
  const server = createServer()
  await server.connect(new StdioServerTransport())
  debug('jira MCP server connected (stdio)')
} catch (err) {
  console.error('[jira-mcp] fatal:', err?.message ?? err)
  process.exit(1)
}
