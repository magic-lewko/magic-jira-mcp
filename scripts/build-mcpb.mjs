/**
 * @fileoverview Package the bundled MCP server as a Claude Desktop MCP Bundle
 * (.mcpb): one file, double-click install, no Node.js needed on the user's
 * machine (Claude Desktop runs Node bundles with its own runtime).
 *
 * Single source of truth: name/version/description/author/userConfig come from
 * plugin.json, the env mapping from .mcp.json, the tool list from src/tools —
 * so the Claude Code plugin and the Desktop bundle never drift apart.
 *
 * Usage: npm run build:mcpb   (rebuilds servers/jira-mcp.mjs first)
 * Output: dist/jira-tools-<version>.mcpb
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pluginDir = join(root, 'plugins', 'jira-tools')
const bundle = join(pluginDir, 'servers', 'jira-mcp.mjs')
const stage = join(root, 'dist', 'mcpb')

/** Fields the server cannot start without — Desktop refuses to install until they are filled. */
const REQUIRED_FIELDS = new Set(['jira_server', 'jira_token'])

const plugin = JSON.parse(readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'))
const mcpJson = JSON.parse(readFileSync(join(pluginDir, '.mcp.json'), 'utf8'))
const { readTools, writeTools } = await import(pathToFileURL(join(pluginDir, 'src', 'tools', 'index.mjs')))

/**
 * First sentence of a tool description — the bundle installer lists tools,
 * the full text stays in the server's tools/list.
 *
 * @param {string} text
 * @returns {string}
 */
function firstSentence(text) {
  // A period ends the sentence only when a capital letter (or nothing) follows,
  // so "e.g. foo" and "i.e. bar" stay inside it.
  const match = /^(.+?\.)(?=\s+[A-Z]|$)/.exec(String(text))
  return (match ? match[1] : String(text)).trim()
}

/**
 * plugin.json userConfig → MCPB user_config (same keys, adds `required`,
 * drops empty defaults so the installer shows a blank field instead of "").
 *
 * @param {Record<string, object>} userConfig
 * @returns {Record<string, object>}
 */
function toUserConfig(userConfig) {
  const out = {}
  for (const [key, field] of Object.entries(userConfig)) {
    const entry = {
      type: field.type,
      title: field.title,
      description: field.description,
      required: REQUIRED_FIELDS.has(key),
    }
    if (field.sensitive) entry.sensitive = true
    if (field.default !== undefined && field.default !== '') entry.default = field.default
    out[key] = entry
  }
  return out
}

const manifest = {
  manifest_version: '0.3',
  name: plugin.name,
  display_name: 'Jira Tools',
  version: plugin.version,
  description: plugin.description,
  long_description: 'Ask Claude about your self-hosted Jira Server: your tasks, sprint health, epic status, '
    + 'bug lookup, and ticket creation with a preview first. Needs a Personal Access Token and a network '
    + 'path to your Jira (VPN when required). Everything runs on your machine.',
  author: plugin.author,
  repository: { type: 'git', url: 'https://github.com/magic-lewko/magic-jira-mcp' },
  keywords: ['jira', 'jira-server', 'agile', 'sprint', 'tickets'],
  server: {
    type: 'node',
    entry_point: 'server/jira-mcp.mjs',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/jira-mcp.mjs'],
      env: mcpJson.mcpServers.jira.env,
    },
  },
  tools: [...readTools, ...writeTools].map((tool) => ({
    name: tool.name,
    description: firstSentence(tool.config.description),
  })),
  user_config: toUserConfig(plugin.userConfig),
  compatibility: {
    platforms: ['win32', 'darwin'],
    runtimes: { node: '>=20.0.0' },
  },
}

// Stage: manifest + the self-contained server bundle, nothing else.
rmSync(stage, { recursive: true, force: true })
mkdirSync(join(stage, 'server'), { recursive: true })
writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
copyFileSync(bundle, join(stage, 'server', 'jira-mcp.mjs'))

// Official CLI, run with the current Node binary so it works on Windows without
// npx/.cmd shims. Path read from node_modules directly: the package's exports
// map hides its package.json from require.resolve.
const cliPkgDir = join(root, 'node_modules', '@anthropic-ai', 'mcpb')
const cli = join(cliPkgDir, JSON.parse(readFileSync(join(cliPkgDir, 'package.json'), 'utf8')).bin)
const output = join(root, 'dist', `${plugin.name}-${plugin.version}.mcpb`)

for (const args of [['validate', join(stage, 'manifest.json')], ['pack', stage, output]]) {
  const result = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`[build-mcpb] mcpb ${args[0]} failed (exit ${result.status})`)
    process.exit(result.status ?? 1)
  }
}
console.error(`[build-mcpb] wrote ${output}`)
