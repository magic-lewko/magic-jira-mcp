/**
 * @fileoverview Shared issue-field logic for create_issue, create_issues and
 * update_issue (SPEC §4.1): custom-field resolution, role-based issue types,
 * parent validation for sub-tasks, and the common fields builder — so a single
 * create and a bulk create apply exactly the same rules.
 */

import { z } from 'zod'
import { JiraError, debug } from './jira-client.mjs'
import { getProjectProfile } from './config.mjs'
import { markdownToWiki } from './wiki-markup.mjs'

// --- custom fields -----------------------------------------------------------

/** Resolved via project profile → field name → custom-type suffix. */
export const EPIC_LINK_FIELD = { profileKey: 'epicLinkField', fieldName: 'Epic Link', customSuffix: ':gh-epic-link' }
export const SPRINT_FIELD = { profileKey: 'sprintField', fieldName: 'Sprint', customSuffix: ':gh-sprint' }
export const EPIC_NAME_FIELD = { profileKey: 'epicNameField', fieldName: 'Epic Name', customSuffix: ':gh-epic-label' }
/**
 * Story Points is matched by NAME only: its custom type is a generic float
 * shared by unrelated numeric fields, so a suffix match could pick any of them.
 */
export const STORY_POINTS_FIELD = { profileKey: 'storyPointsField', fieldName: 'Story Points', customSuffix: null }

/**
 * Resolve a Jira Server custom field id: project profile first, then
 * discovery via /rest/api/2/field by display name, then (when the spec allows)
 * by custom-type suffix. No caching — writes are rare and the profile is the
 * fast path.
 *
 * @param {object} config
 * @param {object} client
 * @param {string} project
 * @param {{profileKey: string, fieldName: string, customSuffix: string|null}} spec
 * @returns {Promise<string>}
 */
export async function resolveField(config, client, project, { profileKey, fieldName, customSuffix }) {
  const fromProfile = getProjectProfile(config, project)[profileKey]
  if (fromProfile) return fromProfile
  const fields = await client.listFields(config)
  const field = fields.find((f) => f.name === fieldName)
    ?? (customSuffix ? fields.find((f) => f.schema?.custom?.endsWith(customSuffix)) : undefined)
  if (!field) {
    throw new JiraError(`Field not found: ${fieldName} — run /jira-tools:jira-config for the project, or omit this parameter.`)
  }
  return field.id
}

// --- issue types by role -----------------------------------------------------

/** Roles a caller may pass instead of a (possibly localised) issue-type name. */
export const ISSUE_ROLES = ['epic', 'story', 'task', 'subtask', 'bug']

/**
 * Fallback name patterns per role. Deliberately loose prefixes/substrings so
 * common localisations still match; the profile's `issueTypeRoles` map is the
 * reliable path and always wins. Sub-tasks use Jira's own `subtask` flag.
 */
const ROLE_PATTERNS = {
  epic: /^epi/i,
  story: /stor/i,
  task: /^task/i,
  bug: /bug/i,
}

/**
 * Issue types of a project with their sub-task flag. Best-effort: when the
 * project cannot be read the caller passes the raw type name through and lets
 * Jira validate it.
 *
 * @param {object} config
 * @param {object} client
 * @param {string} project
 * @returns {Promise<{name: string, subtask: boolean}[]>}
 */
export async function loadProjectTypes(config, client, project) {
  try {
    const proj = await client.getProject(config, project)
    return (proj?.issueTypes ?? []).map((t) => ({ name: String(t.name), subtask: Boolean(t.subtask) }))
  } catch (err) {
    debug('project issue types unavailable, passing the type name through:', err?.message)
    return []
  }
}

/**
 * Resolve an issue type from a role or an exact name. Returns the project's
 * type entry, or null when nothing matched (raw name goes through to Jira).
 *
 * @param {object} config
 * @param {string} project
 * @param {{name: string, subtask: boolean}[]} projectTypes
 * @param {string} requested - role or type name
 * @returns {{name: string, subtask: boolean}|null}
 */
export function resolveIssueType(config, project, projectTypes, requested) {
  const lower = String(requested).trim().toLowerCase()
  const byName = projectTypes.find((t) => t.name.toLowerCase() === lower)
  if (byName) return byName
  if (!ISSUE_ROLES.includes(lower)) return null

  const mapped = getProjectProfile(config, project).issueTypeRoles?.[lower]
  if (mapped) {
    const byMap = projectTypes.find((t) => t.name.toLowerCase() === String(mapped).toLowerCase())
    if (byMap) return byMap
  }
  if (lower === 'subtask') return projectTypes.find((t) => t.subtask) ?? null
  return projectTypes.find((t) => !t.subtask && ROLE_PATTERNS[lower].test(t.name)) ?? null
}

/**
 * Whether a type is an epic: the `epic` role, the profile's mapped epic name,
 * or a name that looks like one.
 *
 * @param {object} config
 * @param {string} project
 * @param {string} typeName - resolved type name
 * @param {string} requested - what the caller passed
 * @returns {boolean}
 */
export function isEpicType(config, project, typeName, requested) {
  if (String(requested).trim().toLowerCase() === 'epic') return true
  const mapped = getProjectProfile(config, project).issueTypeRoles?.epic
  if (mapped && String(mapped).toLowerCase() === String(typeName).toLowerCase()) return true
  return ROLE_PATTERNS.epic.test(String(typeName))
}

/**
 * Propose a role → type-name map for a project profile. Best-effort: the
 * user confirms or completes it in /jira-config, which is what makes localised
 * instances reliable without any localised word in this code.
 *
 * @param {{name: string, subtask?: boolean}[]} projectTypes
 * @returns {Partial<Record<'epic'|'story'|'task'|'subtask'|'bug', string>>}
 */
export function detectIssueTypeRoles(projectTypes) {
  const roles = {}
  const sub = projectTypes.find((t) => t.subtask)
  if (sub) roles.subtask = sub.name
  for (const role of ['epic', 'story', 'task', 'bug']) {
    const hit = projectTypes.find((t) => !t.subtask && ROLE_PATTERNS[role].test(t.name))
    if (hit) roles[role] = hit.name
  }
  return roles
}

// --- shared input schema -----------------------------------------------------

/** Per-issue input, shared by create_issue (plus `project`) and create_issues items. */
export const ISSUE_ITEM_INPUT = {
  issue_type: z.string().describe(
    `Issue type: a role (${ISSUE_ROLES.join('/')}) resolved to the project's own type name `
    + '(via the profile\'s issueTypeRoles, else by name), or the exact type name',
  ),
  summary: z.string().min(5).describe('Issue title'),
  description: z.string().optional().describe(
    'Description in Markdown — converted to Jira wiki markup, because Jira Server does not render '
    + 'Markdown. Set description_format="wiki" to pass wiki markup through unchanged',
  ),
  description_format: z.enum(['markdown', 'wiki']).optional().describe('Format of description; default "markdown"'),
  components: z.array(z.string()).optional().describe('Component names, e.g. ["iOS"]'),
  labels: z.array(z.string()).optional(),
  assignee: z.string().optional().describe('Jira username to assign'),
  epic_key: z.string().optional().describe('Epic to link the issue to (Epic Link)'),
  epic_name: z.string().optional().describe(
    'Epic Name — Jira requires it on an epic; defaults to the summary when creating an epic',
  ),
  parent: z.string().optional().describe('Parent issue key, required for a sub-task type, e.g. "PROJ-42"'),
  story_points: z.number().optional().describe('Story Points'),
  sprint_id: z.number().int().optional()
    .describe('Sprint id to place the issue in (find it via get_active_sprint); omit for backlog'),
  allow_duplicate: z.boolean().optional()
    .describe('Set true ONLY when the user explicitly confirmed creating a near-duplicate'),
}

// --- fields builder ----------------------------------------------------------

/**
 * Build the Jira fields payload for ONE issue. Applies, in code: role-based
 * type resolution, sub-task/parent validation (B1), Epic Name (B2), Story
 * Points (P1), Markdown → wiki (P2) and the always-on `ai-generated` label.
 *
 * @param {object} args - per-issue arguments (see ISSUE_ITEM_INPUT)
 * @param {{config: object, client: object, project: string, projectTypes: {name: string, subtask: boolean}[]}} ctx
 * @returns {Promise<{fields: object, summary: string, typeName: string, parentKey: string|undefined}>}
 */
export async function buildIssueFields(args, { config, client, project, projectTypes }) {
  const summary = args.summary.trim()
  const requestedType = args.issue_type.trim()
  const resolvedType = resolveIssueType(config, project, projectTypes, requestedType)
  const typeName = resolvedType?.name ?? requestedType

  let parentKey
  if (args.parent) {
    parentKey = args.parent.trim().toUpperCase()
    if (resolvedType && !resolvedType.subtask) {
      const subtaskTypes = projectTypes.filter((t) => t.subtask).map((t) => t.name)
      throw new JiraError(
        `"${typeName}" is not a sub-task type, so it cannot have a parent. `
        + (subtaskTypes.length
          ? `Sub-task types in ${project}: ${subtaskTypes.join(', ')}.`
          : `Project ${project} has no sub-task type.`),
      )
    }
    const parent = await client.getIssue(config, parentKey, { fields: ['issuetype', 'summary'] })
    if (parent.fields?.issuetype?.subtask) {
      throw new JiraError(`${parentKey} is itself a sub-task — a sub-task cannot be the parent of another sub-task.`)
    }
  } else if (resolvedType?.subtask) {
    throw new JiraError(`"${typeName}" is a sub-task type and requires a parent — pass parent="${project}-123".`)
  }

  const fields = {
    project: { key: project },
    issuetype: { name: typeName },
    summary,
  }
  if (parentKey) fields.parent = { key: parentKey }
  if (args.description) {
    fields.description = args.description_format === 'wiki' ? args.description : markdownToWiki(args.description)
  }
  if (args.components?.length) fields.components = args.components.map((name) => ({ name }))
  // AI transparency (enforced in code, always on): every agent-created issue
  // gets a filterable `ai-generated` label.
  const labels = [...(args.labels ?? [])]
  if (!labels.includes('ai-generated')) labels.push('ai-generated')
  fields.labels = labels
  if (args.assignee) fields.assignee = { name: args.assignee }
  if (args.epic_key) {
    fields[await resolveField(config, client, project, EPIC_LINK_FIELD)] = args.epic_key.trim().toUpperCase()
  }
  if (args.sprint_id !== undefined) {
    fields[await resolveField(config, client, project, SPRINT_FIELD)] = args.sprint_id
  }
  const epicName = args.epic_name?.trim() || (isEpicType(config, project, typeName, requestedType) ? summary : undefined)
  if (epicName) {
    fields[await resolveField(config, client, project, EPIC_NAME_FIELD)] = epicName
  }
  if (args.story_points !== undefined) {
    fields[await resolveField(config, client, project, STORY_POINTS_FIELD)] = args.story_points
  }

  return { fields, summary, typeName, parentKey }
}
