import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  formatIssueLine, formatIssueList, formatIssueFull, formatSprint,
  formatBoards, formatChangelog, formatEpicStatus,
} from '../../plugins/jira-tools/src/format.mjs'

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'issue-full.json'), 'utf8'),
)

test('formatIssueLine: snapshot on the fixture', () => {
  assert.equal(
    formatIssueLine(fixture),
    'PROJ-42 [In Progress] Bug/High — [123] Login screen crashes on empty password'
    + ' · Jan Kowalski · labels: UAT,mobile · upd: 2026-07-10',
  )
})

test('formatIssueLine: tolerates missing fields', () => {
  assert.equal(
    formatIssueLine({ key: 'PROJ-1', fields: {} }),
    'PROJ-1 [?] ?/? — (no title) · Unassigned',
  )
})

test('formatIssueList: truncation note appears exactly when page is partial', () => {
  const page = { issues: [fixture], total: 2, startAt: 0 }
  assert.match(formatIssueList(page), /\(showing 1 of 2 — narrow the JQL or raise max_results\)/)

  const complete = { issues: [fixture, fixture], total: 2, startAt: 0 }
  assert.doesNotMatch(formatIssueList(complete), /showing/)

  assert.equal(formatIssueList({ issues: [], total: 0 }), 'No results.')
})

test('formatIssueFull: snapshot on the fixture', () => {
  const text = formatIssueFull(fixture, { server: 'https://jira.example.pl' })
  assert.equal(text, [
    'PROJ-42 — [123] Login screen crashes on empty password',
    'Bug · High · In Progress · Jan Kowalski · reporter: Anna Nowak',
    'components: iOS, Android · labels: UAT, mobile · fixVersions: 1.4.0'
    + ' · parent/epic: PROJ-40 (Login epic work) · created: 2026-07-01, updated: 2026-07-10',
    'https://jira.example.pl/browse/PROJ-42',
    '',
    'DESCRIPTION:',
    'Steps:\n1. Open login\n2. Leave password empty\n3. Tap submit\n\nExpected: validation error\nActual: crash',
    '',
    'ATTACHMENTS (1):',
    '- crash.log  https://jira.example.pl/secure/attachment/10001/crash.log',
    '',
    'COMMENTS (2):',
    '• Anna Nowak (2026-07-09):',
    '  Reproduced on iOS 18.\n  Crash log attached.',
    '• Jan Kowalski (2026-07-10):',
    '  Fix in review.',
  ].join('\n'))
})

test('formatIssueFull: compact mode caps comments at 5 with a truncation note', () => {
  const issue = {
    key: 'PROJ-1',
    fields: {
      summary: 'Big ticket',
      description: 'x'.repeat(5000),
      comment: {
        comments: Array.from({ length: 8 }, (_, i) => ({
          author: { displayName: `User${i + 1}` },
          created: `2026-07-0${(i % 7) + 1}T10:00:00.000+0200`,
          body: `komentarz ${i + 1}`,
        })),
      },
    },
  }

  const compact = formatIssueFull(issue)
  assert.match(compact, /COMMENTS \(showing the last 5 of 8 — full list: all_comments=true\):/)
  assert.doesNotMatch(compact, /komentarz 3\b/)
  assert.match(compact, /komentarz 8/)
  assert.match(compact, /… \(description truncated — full text: all_comments=true\)/)
  assert.ok(!compact.includes('x'.repeat(4500)), 'description must be capped')

  const full = formatIssueFull(issue, { full: true })
  assert.match(full, /COMMENTS \(8\):/)
  assert.match(full, /komentarz 1\b/)
  assert.ok(full.includes('x'.repeat(5000)), 'full mode keeps the whole description')
})

test('formatSprint: name, dates, goal', () => {
  const text = formatSprint({
    id: 5, name: 'Sprint 12', state: 'active',
    startDate: '2026-07-06T08:00:00.000Z', endDate: '2026-07-20T16:00:00.000Z', goal: 'Ship login',
  })
  assert.equal(text, 'Sprint: Sprint 12 (active, id: 5)\nDates: 2026-07-06 → 2026-07-20\nGoal: Ship login')
})

test('formatBoards: one line per board, empty message', () => {
  const text = formatBoards([
    { id: 1, name: 'Alpha board', type: 'scrum', location: { projectKey: 'PROJ' } },
    { id: 2, name: 'Ops', type: 'kanban' },
  ])
  assert.equal(text, '1 — Alpha board (scrum, project: PROJ)\n2 — Ops (kanban)')
  assert.equal(formatBoards([]), 'No boards.')
})

test('formatChangelog: only status transitions, with dates and authors', () => {
  const issue = {
    key: 'PROJ-42',
    changelog: {
      histories: [
        {
          created: '2026-07-08T10:00:00.000+0200',
          author: { displayName: 'Jan Kowalski' },
          items: [
            { field: 'status', fromString: 'To Do', toString: 'In Progress' },
            { field: 'assignee', fromString: 'X', toString: 'Y' },
          ],
        },
      ],
    },
  }
  assert.equal(
    formatChangelog(issue),
    'PROJ-42 — status history:\n2026-07-08  To Do → In Progress  (Jan Kowalski)',
  )
  assert.equal(formatChangelog({ key: 'PROJ-1', changelog: { histories: [] } }), 'PROJ-1: no status changes in history.')
})

test('formatEpicStatus: counts per status + open list', () => {
  const child = (key, status, categoryKey) => ({
    key,
    fields: { summary: `t-${key}`, status: { name: status, statusCategory: { key: categoryKey } }, issuetype: { name: 'Task' }, priority: { name: 'Medium' } },
  })
  const text = formatEpicStatus('PROJ-40', {
    issues: [child('PROJ-41', 'Done', 'done'), child('PROJ-42', 'In Progress', 'indeterminate')],
    total: 2,
  })
  assert.match(text, /Epic PROJ-40 — 2 issues:/)
  assert.match(text, /1 {2}Done/)
  assert.match(text, /Open \(1\):/)
  assert.match(text, /PROJ-42 \[In Progress\]/)

  assert.equal(formatEpicStatus('PROJ-9', { issues: [], total: 0 }), 'Epic PROJ-9: no linked issues.')
})
