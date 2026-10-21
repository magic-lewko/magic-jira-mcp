/**
 * @fileoverview Update channel for the Claude Desktop bundle.
 *
 * A sideloaded .mcpb never updates itself (only extensions from Anthropic's
 * directory do), so the server does the next best thing: the repo's main
 * branch publishes releases/latest.json ({version, file, sha256, size}) next
 * to a fixed-name copy of the bundle, the server compares its own VERSION
 * with that feed, and download_update saves the newest bundle into the
 * user's Downloads folder. Installing stays a double-click in Claude Desktop.
 *
 * Env: JIRA_CLIENT=desktop (set by the bundle manifest) selects the Desktop
 * wording, JIRA_NO_UPDATE_CHECK=1 silences the check in get_version,
 * JIRA_DOWNLOAD_DIR overrides the target folder (tests).
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { JiraError } from './jira-client.mjs'
import { VERSION } from './version.mjs'

/** Raw file base of the update feed: the repo's main branch, releases/ folder. */
export const RELEASE_BASE = 'https://raw.githubusercontent.com/magic-lewko/magic-jira-mcp/main/releases/'

/** Marketplace name used in the Claude Code update commands. */
export const MARKETPLACE = 'magic-jira-mcp'

/** Refuse anything bigger than this — the real bundle is well under 1 MB. */
const MAX_BUNDLE_BYTES = 25 * 1024 * 1024

/**
 * Compare two dotted version strings numerically ("0.10.0" > "0.9.1").
 *
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1}
 */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff) return diff < 0 ? -1 : 1
  }
  return 0
}

/**
 * True when this server runs from the Claude Desktop bundle (manifest env).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isDesktop(env = process.env) {
  return env.JIRA_CLIENT === 'desktop'
}

/**
 * How the user gets the new version, per client.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function updateHint(env = process.env) {
  return isDesktop(env)
    ? 'Call download_update to get the new .mcpb file.'
    : `Run /plugin marketplace update ${MARKETPLACE}, then /plugin install jira-tools@${MARKETPLACE}, `
      + 'then /jira-tools:jira-update.'
}

/**
 * Read the update feed. Throws a JiraError with a ready-to-show message on
 * any failure (offline, timeout, no release yet, malformed feed).
 *
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<{version: string, file: string, sha256: string, size?: number}>}
 */
export async function fetchLatest({ timeoutMs = 5_000 } = {}) {
  let res
  try {
    res = await fetch(`${RELEASE_BASE}latest.json`, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    const why = err?.name === 'TimeoutError' ? 'timed out' : 'no connection'
    throw new JiraError(`Update check failed: ${why} (${RELEASE_BASE}latest.json).`)
  }
  if (res.status === 404) throw new JiraError('Update check: no release published yet.')
  if (!res.ok) throw new JiraError(`Update check failed: HTTP ${res.status} for latest.json.`)
  const latest = await res.json().catch(() => null)
  if (!latest?.version || !latest?.file || !latest?.sha256) {
    throw new JiraError('Update check failed: latest.json is malformed.')
  }
  return latest
}

/**
 * Folder for the downloaded bundle: JIRA_DOWNLOAD_DIR, else ~/Downloads when
 * it exists, else the temp folder.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function downloadDir(env = process.env) {
  if (env.JIRA_DOWNLOAD_DIR) return env.JIRA_DOWNLOAD_DIR
  const downloads = join(homedir(), 'Downloads')
  return existsSync(downloads) ? downloads : tmpdir()
}

/**
 * Download the bundle named in the feed, verify its SHA-256 and save it as
 * jira-tools-<version>.mcpb in `dir`. Nothing is written on a mismatch.
 *
 * @param {{version: string, file: string, sha256: string}} latest
 * @param {string} [dir]
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<string>} absolute path of the saved file
 */
export async function downloadBundle(latest, dir = downloadDir(), { timeoutMs = 60_000 } = {}) {
  let res
  try {
    res = await fetch(`${RELEASE_BASE}${latest.file}`, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    throw new JiraError(`Download failed: ${err?.name === 'TimeoutError' ? 'timed out' : 'no connection'}.`)
  }
  if (!res.ok) throw new JiraError(`Download failed: HTTP ${res.status} for ${latest.file}.`)
  const declared = Number(res.headers.get('content-length')) || 0
  if (declared > MAX_BUNDLE_BYTES) throw new JiraError(`Download refused: ${latest.file} is larger than 25 MB.`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > MAX_BUNDLE_BYTES) throw new JiraError(`Download refused: ${latest.file} is larger than 25 MB.`)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== String(latest.sha256).toLowerCase()) {
    throw new JiraError('Download failed: checksum mismatch, the file was not saved. Try again in a few minutes.')
  }
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `jira-tools-${latest.version}.mcpb`)
  writeFileSync(path, bytes)
  return path
}

/**
 * One status line for get_version. Never throws: a failed check is reported
 * as text so the health check still answers offline.
 *
 * @param {{current?: string, env?: NodeJS.ProcessEnv}} [opts]
 * @returns {Promise<string>}
 */
export async function updateStatusLine({ current = VERSION, env = process.env } = {}) {
  if (env.JIRA_NO_UPDATE_CHECK === '1') return 'Update check: disabled (JIRA_NO_UPDATE_CHECK=1).'
  let latest
  try {
    latest = await fetchLatest({ timeoutMs: 3_000 })
  } catch (err) {
    return err.message
  }
  const cmp = compareVersions(current, latest.version)
  if (cmp === 0) return `Update check: up to date (${latest.version} is the latest release).`
  if (cmp > 0) return `Update check: you run ${current}, ahead of the latest release ${latest.version}.`
  return `Update check: version ${latest.version} is available (you run ${current}). ${updateHint(env)}`
}
