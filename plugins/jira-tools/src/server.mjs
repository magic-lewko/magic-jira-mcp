/**
 * @fileoverview MCP server assembly: loads config, wires tools to the client,
 * enforces the read-only-by-default write gate.
 *
 * Config is re-read on EVERY tool call (the file is tiny) so /jira-setup can
 * write it and the very next call works without restarting the server.
 * The write-tool gate, however, is evaluated at startup — enabling
 * JIRA_ALLOW_WRITE requires /reload-plugins.
 *
 * HARD RULE: nothing here may write to stdout — stdout is the MCP transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { loadConfig } from './config.mjs'
import * as jiraClient from './jira-client.mjs'
import { JiraError } from './jira-client.mjs'
import { readTools, writeTools } from './tools/index.mjs'

/** Shown by every tool until the user completes the setup. */
const NOT_CONFIGURED_MESSAGE =
  'Jira nie jest jeszcze skonfigurowana. W Claude Code uruchom /jira-tools:jira-setup. '
  + 'Alternatywnie utwórz plik ~/.config/jira-tools/config.json z polami "server" i "token" '
  + '(szczegóły: README pluginu jira-tools).'

/**
 * Wrap a tool's run() into an MCP handler: config guard, error mapping,
 * text content envelope.
 *
 * @param {{run: (args: object, ctx: object) => Promise<string>}} tool
 * @param {{getConfig: () => object|null, client: object}} deps
 * @returns {(args: object) => Promise<object>}
 */
function toHandler(tool, { getConfig, client }) {
  return async (args) => {
    const config = getConfig()
    if (!config) {
      return { content: [{ type: 'text', text: NOT_CONFIGURED_MESSAGE }] }
    }
    try {
      const text = await tool.run(args ?? {}, { config, client })
      return { content: [{ type: 'text', text }] }
    } catch (err) {
      const text = err instanceof JiraError
        ? err.message
        : `Nieoczekiwany błąd: ${err?.message ?? err}`
      return { isError: true, content: [{ type: 'text', text }] }
    }
  }
}

/**
 * Register ALL tools (read + write). There is no write-mode: writes are
 * available by default. The remaining safety lives inside the write tools
 * (session budget against loops, duplicate guard) and in /create-task's
 * mandatory dry-run, plus Claude Code's own per-call permission prompts.
 *
 * @param {{registerTool: Function}} server - McpServer or a test stub
 * @param {{getConfig?: () => object|null, client?: object}} [deps]
 * @param {{read?: object[], write?: object[]}} [tools] - injectable for tests
 * @returns {{registerTool: Function}} the same server
 */
export function registerTools(
  server,
  { getConfig = () => loadConfig(), client = jiraClient } = {},
  { read = readTools, write = writeTools } = {},
) {
  const deps = { getConfig, client }
  for (const tool of [...read, ...write]) {
    server.registerTool(tool.name, tool.config, toHandler(tool, deps))
  }
  return server
}

/**
 * Build the ready-to-connect MCP server (name "jira").
 *
 * @param {{getConfig?: () => object|null, client?: object}} [deps]
 * @returns {McpServer}
 */
export function createServer(deps = {}) {
  const server = new McpServer({ name: 'jira', version: '0.4.0' })
  registerTools(server, deps)
  return server
}
