/**
 * @fileoverview Configuration loading for the Jira MCP server.
 *
 * Precedence (first wins, per key): environment variables → user config file →
 * nothing (the server still starts; every tool then returns setup instructions).
 *
 * The config file lives at ~/.config/jira-tools/config.json and is written by
 * the /jira-tools:jira-setup skill — this module only reads it. It may contain
 * a `projects` section with per-project profiles (statuses, board, epic link
 * field, components) populated by /jira-tools:jira-config.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Default status list used when a project has no saved profile.
 * A template, not a guarantee — profiles override it per project.
 * Extra fallback for exotic workflows: Jira's built-in statusCategory.
 */
export const DEFAULT_STATUSES = [
  'To Do', 'To Fix', 'In Progress', 'Code Review', 'Dev Done',
  'On Hold', 'Ready for QA', 'QA', 'Done',
]

/**
 * Absolute path of the user config file.
 *
 * @returns {string}
 */
export function configPath() {
  return join(homedir(), '.config', 'jira-tools', 'config.json')
}

/**
 * Strip trailing slashes from a base URL (loop instead of regex to stay linear).
 *
 * @param {string} url
 * @returns {string}
 */
function trimTrailingSlashes(url) {
  let end = url.length
  while (end > 0 && url[end - 1] === '/') end--
  return url.slice(0, end)
}

/**
 * Read and parse the config file; returns {} when missing or invalid.
 *
 * @param {string} path
 * @returns {object}
 */
function readConfigFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

/**
 * Load the effective configuration. Env vars win over file values per key.
 * Returns `null` when neither server nor token is available anywhere —
 * callers treat that as "not configured".
 *
 * @param {{env?: NodeJS.ProcessEnv, path?: string}} [opts] - injectable for tests
 * @returns {{server: string, token: string, allowWrite: boolean, defaultProject: string|undefined, language: string, projects: object}|null}
 */
export function loadConfig({ env = process.env, path = configPath() } = {}) {
  const file = readConfigFile(path)

  const server = env.JIRA_SERVER || file.server
  const token = env.JIRA_TOKEN || file.token
  if (!server || !token) return null

  const allowWriteRaw = env.JIRA_ALLOW_WRITE ?? file.allowWrite
  return {
    server: trimTrailingSlashes(String(server)),
    token: String(token),
    allowWrite: allowWriteRaw === true || allowWriteRaw === 'true',
    defaultProject: env.JIRA_DEFAULT_PROJECT || file.defaultProject || undefined,
    language: env.JIRA_LANG || file.language || 'pl',
    projects: typeof file.projects === 'object' && file.projects !== null ? file.projects : {},
    writeBudget: {
      creates: positiveInt(env.JIRA_WRITE_BUDGET_CREATES) ?? positiveInt(file.writeBudget?.creates) ?? 10,
      total: positiveInt(env.JIRA_WRITE_BUDGET_TOTAL) ?? positiveInt(file.writeBudget?.total) ?? 30,
    },
  }
}

/**
 * Parse a positive integer or return undefined.
 *
 * @param {unknown} value
 * @returns {number|undefined}
 */
function positiveInt(value) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

/**
 * Project profile lookup with a safe fallback: unknown projects get the
 * default status list and no board/epic-field hints.
 *
 * @param {ReturnType<typeof loadConfig>} config
 * @param {string} projectKey - e.g. 'PROJ'
 * @returns {{statuses: string[], boardId?: number, boardName?: string, epicLinkField?: string, components?: string[], issueTypes?: string[]}}
 */
export function getProjectProfile(config, projectKey) {
  const profile = config?.projects?.[String(projectKey).toUpperCase()] ?? {}
  return {
    statuses: Array.isArray(profile.statuses) && profile.statuses.length > 0
      ? profile.statuses
      : DEFAULT_STATUSES,
    ...profile,
  }
}
