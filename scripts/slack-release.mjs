/**
 * @fileoverview Post the Claude Desktop bundle (.mcpb) of the current version
 * to a Slack channel, with the release message as the comment.
 *
 * Uses the Slack bot of the "jira-tools-release" app (scopes: files:write,
 * chat:write). The bot must be a member of the channel (/invite it once).
 *
 * Credentials: SLACK_BOT_TOKEN and SLACK_CHANNEL_ID from the environment or
 * from the git-ignored .env.local in the repo root (environment wins).
 *
 * The install guides live in the company workspace, so their links stay out of
 * the repo: the message uses {desktop_guide} and {code_guide} placeholders,
 * filled from SLACK_DESKTOP_GUIDE_URL and SLACK_CODE_GUIDE_URL.
 *
 * Usage:
 *   npm run build:mcpb
 *   node scripts/slack-release.mjs "<message>" [--dry-run]
 * Uploads dist/jira-tools-<version>.mcpb (version from plugin.json).
 * --dry-run prints the final message and posts nothing.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const plugin = JSON.parse(readFileSync(join(root, 'plugins', 'jira-tools', '.claude-plugin', 'plugin.json'), 'utf8'))
const file = join(root, 'dist', `${plugin.name}-${plugin.version}.mcpb`)
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const template = args.find((arg) => arg !== '--dry-run') || `${plugin.name} ${plugin.version}`

/**
 * KEY=value pairs of .env.local (missing file → empty object).
 *
 * @returns {Record<string, string>}
 */
function readEnvLocal() {
  const path = join(root, '.env.local')
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match) out[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

const envLocal = readEnvLocal()
const token = process.env.SLACK_BOT_TOKEN || envLocal.SLACK_BOT_TOKEN
const channel = process.env.SLACK_CHANNEL_ID || envLocal.SLACK_CHANNEL_ID
const placeholders = {
  '{desktop_guide}': 'SLACK_DESKTOP_GUIDE_URL',
  '{code_guide}': 'SLACK_CODE_GUIDE_URL',
}

let message = template
for (const [placeholder, key] of Object.entries(placeholders)) {
  if (!message.includes(placeholder)) continue
  const url = process.env[key] || envLocal[key]
  if (!url) {
    console.error(`[slack-release] ${placeholder} needs ${key} (env or .env.local).`)
    process.exit(1)
  }
  message = message.replaceAll(placeholder, url)
}

if (dryRun) {
  console.error(message)
  process.exit(0)
}
if (!token || !channel) {
  console.error('[slack-release] Set SLACK_BOT_TOKEN and SLACK_CHANNEL_ID (env or .env.local).')
  process.exit(1)
}
if (!existsSync(file)) {
  console.error(`[slack-release] ${basename(file)} not found — run npm run build:mcpb first.`)
  process.exit(1)
}

/**
 * Call a Slack Web API method and fail loudly on ok:false.
 *
 * @param {string} method
 * @param {RequestInit} init
 * @returns {Promise<object>}
 */
async function slack(method, init) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  })
  const body = await res.json()
  if (!body.ok) {
    const hint = body.error === 'not_in_channel' || body.error === 'channel_not_found'
      ? ' — invite the bot to the channel: /invite @jira-tools-release'
      : ''
    throw new Error(`${method}: ${body.error}${hint}`)
  }
  return body
}

// Slack's external upload flow: reserve an upload URL, send the bytes, then
// share the file in the channel with the message as its comment.
const bytes = readFileSync(file)
const { upload_url: uploadUrl, file_id: fileId } = await slack('files.getUploadURLExternal', {
  method: 'POST',
  body: new URLSearchParams({ filename: basename(file), length: String(statSync(file).size) }),
})

const upload = await fetch(uploadUrl, { method: 'POST', body: bytes })
if (!upload.ok) throw new Error(`upload failed: HTTP ${upload.status}`)

await slack('files.completeUploadExternal', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    files: [{ id: fileId, title: basename(file) }],
    channel_id: channel,
    initial_comment: message,
  }),
})

console.error(`[slack-release] posted ${basename(file)} to ${channel}`)
