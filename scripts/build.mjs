/**
 * @fileoverview Bundle the MCP server into a single self-contained file
 * (SPEC §3: servers/jira-mcp.mjs must run without node_modules, because the
 * plugin directory is what gets installed — not the repo root).
 *
 * Usage: npm run build   (re-run after every change in plugins/jira-tools/src/)
 */

import { build } from 'esbuild'

await build({
  entryPoints: ['plugins/jira-tools/src/main.mjs'],
  outfile: 'plugins/jira-tools/servers/jira-mcp.mjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // Some transitive deps use require(); provide it in the ESM bundle.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
})
