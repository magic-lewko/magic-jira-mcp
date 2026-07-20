#!/usr/bin/env node
/**
 * @fileoverview PreToolUse hook: the safety switches (`allowWrite` fields in
 * ~/.config/jira-tools/config.json) may be changed ONLY with a human in the
 * loop. Any Edit/Write/Bash that would flip them triggers a manual permission
 * prompt (permissionDecision "ask") instead of running silently — an agent
 * cannot enable writes for itself.
 *
 * Design notes:
 * - "ask", not "deny": /jira-setup and /jira-config legitimately write these
 *   fields after interviewing the user — the human just confirms the prompt.
 * - Edits are SIMULATED and the resulting allowWrite values compared, so a
 *   sneaky `replace_all: "false" -> "true"` without the word "allowWrite"
 *   is caught too.
 * - Limitation (platform): in auto / bypassPermissions modes Claude Code
 *   overrides "ask" and the tool runs without a prompt.
 * - stdout carries ONLY the hook JSON protocol; diagnostics would go to stderr.
 */

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const CONFIG_PATH_SUFFIX = '.config/jira-tools/config.json'

const ASK_REASON =
  'Ta operacja zmienia bezpiecznik zapisu (allowWrite) w ~/.config/jira-tools/config.json. '
  + 'Zmiana bezpieczników wymaga ręcznego potwierdzenia — zatwierdź tylko, jeśli sam(a) o nią poprosiłeś/aś.'

/**
 * Normalize a filesystem path for comparison (Windows separators, case).
 *
 * @param {unknown} p
 * @returns {string}
 */
function normalizePath(p) {
  return String(p ?? '').replaceAll('\\', '/').toLowerCase()
}

/**
 * Does the path point at the jira-tools user config?
 *
 * @param {unknown} filePath
 * @returns {boolean}
 */
function isConfigPath(filePath) {
  return normalizePath(filePath).endsWith(CONFIG_PATH_SUFFIX)
}

/**
 * Extract every allowWrite value (global + per project) from a parsed config.
 *
 * @param {any} json
 * @returns {Record<string, boolean>}
 */
function allowWriteMap(json) {
  const map = { global: json?.allowWrite === true }
  for (const [key, profile] of Object.entries(json?.projects ?? {})) {
    map[`projects.${key}`] = profile?.allowWrite === true
  }
  return map
}

/**
 * Do two allowWrite maps differ on any key?
 *
 * @param {Record<string, boolean>} a
 * @param {Record<string, boolean>} b
 * @returns {boolean}
 */
function mapsDiffer(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if ((a[k] ?? false) !== (b[k] ?? false)) return true
  }
  return false
}

/**
 * Apply Edit/MultiEdit string replacements the same way the Edit tool would.
 *
 * @param {string} content
 * @param {{old_string?: string, new_string?: string, replace_all?: boolean}[]} edits
 * @returns {string}
 */
function applyEdits(content, edits) {
  let out = content
  for (const e of edits) {
    const oldS = String(e.old_string ?? '')
    if (!oldS) continue
    const newS = String(e.new_string ?? '')
    out = e.replace_all ? out.replaceAll(oldS, newS) : out.replace(oldS, newS)
  }
  return out
}

/**
 * Core decision, pure for testability. Returns the reason string when a manual
 * prompt is required, or null when the hook has no opinion.
 *
 * @param {{tool_name?: string, tool_input?: any}} payload - PreToolUse stdin JSON
 * @param {(path: string) => string} [readFile] - injectable file reader
 * @returns {string|null}
 */
export function decide(payload, readFile = (p) => readFileSync(p, 'utf8')) {
  const tool = payload?.tool_name
  const input = payload?.tool_input ?? {}

  if (tool === 'Bash') {
    const command = String(input.command ?? '')
    const touchesConfig = normalizePath(command).includes('jira-tools/config.json')
    return touchesConfig && command.includes('allowWrite') ? ASK_REASON : null
  }

  if (tool !== 'Edit' && tool !== 'Write' && tool !== 'MultiEdit') return null
  if (!isConfigPath(input.file_path)) return null

  let currentRaw
  try {
    currentRaw = readFile(input.file_path)
  } catch {
    return null // no config yet (first setup) — nothing to protect
  }

  let current
  try {
    current = JSON.parse(currentRaw)
  } catch {
    return null // existing file is not valid JSON — no switches to flip
  }

  let nextRaw
  if (tool === 'Write') {
    nextRaw = String(input.content ?? '')
  } else {
    const edits = tool === 'MultiEdit' ? (input.edits ?? []) : [input]
    nextRaw = applyEdits(currentRaw, edits)
  }

  let next
  try {
    next = JSON.parse(nextRaw)
  } catch {
    // Config would stop being valid JSON — allow only when the change clearly
    // has nothing to do with the switches.
    return nextRaw.includes('allowWrite') || currentRaw.includes('allowWrite') ? ASK_REASON : null
  }

  return mapsDiffer(allowWriteMap(current), allowWriteMap(next)) ? ASK_REASON : null
}

/** Read stdin, decide, emit the hook protocol answer (or nothing). */
async function main() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  let payload
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return // malformed input — no opinion
  }
  const reason = decide(payload)
  if (!reason) return
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason,
    },
  }))
}

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (runDirectly) await main()
