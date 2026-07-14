/**
 * @fileoverview Fetch FULL detail (description + comments + meta) for specific issues.
 *
 * Read-only. Pulls the body of each ticket so you can read descriptions,
 * comments and attachment links without opening the browser.
 *
 * Usage (PowerShell):
 *   $env:JIRA_SERVER="https://jira.example.pl"
 *   $env:JIRA_TOKEN="<personal access token>"
 *   node references/jira_show.mjs PROJ-98 PROJ-99 PROJ-111
 *   node references/jira_show.mjs PROJ-98..PROJ-111      # inclusive range shorthand
 *
 * Optional:
 *   --json    # dump raw issue JSON instead of the readable text
 */

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

const JIRA_SERVER = trimTrailingSlashes(process.env.JIRA_SERVER || process.env.VITE_JIRA_SERVER || '')
const TOKEN = process.env.JIRA_TOKEN || process.env.VITE_JIRA_TOKEN
const AS_JSON = process.argv.includes('--json')

if (!TOKEN) { console.error('Set JIRA_TOKEN'); process.exit(1) }
if (!JIRA_SERVER) { console.error('Set JIRA_SERVER'); process.exit(1) }

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/json',
}

/**
 * Expand CLI args into a flat list of issue keys.
 * Accepts bare keys plus "PROJ-98..PROJ-111" (or "PROJ-98..111") inclusive ranges.
 *
 * @param {string[]} args - raw CLI arguments (flags are ignored)
 * @returns {string[]} expanded issue keys
 */
function expandKeys(args) {
  const out = []
  for (const arg of args.filter((a) => !a.startsWith('--'))) {
    const range = /^([A-Z]+)-(\d+)\.\.(?:[A-Z]+-)?(\d+)$/.exec(arg)
    if (range) {
      const [, proj, from, to] = range
      const lo = Number(from)
      const hi = Number(to)
      for (let n = lo; n <= hi; n++) out.push(`${proj}-${n}`)
    } else {
      out.push(arg)
    }
  }
  return out
}

const KEYS = expandKeys(process.argv.slice(2))
if (KEYS.length === 0) {
  console.error('Pass at least one issue key, e.g. node references/jira_show.mjs PROJ-98..PROJ-111')
  process.exit(1)
}

const FIELDS = [
  'summary', 'status', 'issuetype', 'priority', 'assignee', 'reporter',
  'created', 'updated', 'labels', 'components', 'description', 'comment',
  'attachment', 'parent', 'fixVersions',
].join(',')

/**
 * Fetch a single issue with the full field set.
 *
 * @param {string} key - issue key, e.g. 'PROJ-98'
 * @returns {Promise<object>} raw issue JSON
 */
async function fetchIssue(key) {
  const url = `${JIRA_SERVER}/rest/api/2/issue/${key}?fields=${FIELDS}`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`${key}: ${res.status} — ${await res.text()}`)
  return res.json()
}

const issues = []
for (const key of KEYS) {
  try {
    issues.push(await fetchIssue(key))
  } catch (err) {
    console.error(`! ${err.message}`)
  }
}

if (AS_JSON) {
  console.log(JSON.stringify(issues, null, 2))
  process.exit(0)
}

const line = '─'.repeat(80)
for (const it of issues) {
  const f = it.fields
  console.log(`\n${line}\n${it.key}  —  ${f.summary}`)
  console.log(
    `  ${f.issuetype?.name || '?'} · ${f.priority?.name || '?'} · ${f.status?.name || '?'}` +
      ` · ${f.assignee?.displayName || 'Unassigned'}` +
      ` · comp: ${(f.components || []).map((c) => c.name).join(', ') || '(none)'}`,
  )
  if ((f.labels || []).length) console.log(`  labels: ${f.labels.join(', ')}`)
  console.log(`\nDESCRIPTION:\n${(f.description || '(empty)').trim()}`)

  const atts = f.attachment || []
  if (atts.length) {
    console.log(`\nATTACHMENTS (${atts.length}):`)
    for (const a of atts) console.log(`  - ${a.filename}  ${a.content}`)
  }

  const comments = f.comment?.comments || []
  if (comments.length) {
    console.log(`\nCOMMENTS (${comments.length}):`)
    for (const c of comments) {
      console.log(`  • ${c.author?.displayName || '?'} (${c.created?.slice(0, 10)}):`)
      console.log(`    ${(c.body || '').trim().replaceAll('\n', '\n    ')}`)
    }
  }
}
console.log(`\n${line}\n${issues.length}/${KEYS.length} issue(s) fetched.`)
