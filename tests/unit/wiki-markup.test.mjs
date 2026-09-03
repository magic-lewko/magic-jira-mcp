import { test } from 'node:test'
import assert from 'node:assert/strict'

import { markdownToWiki } from '../../plugins/jira-tools/src/wiki-markup.mjs'

test('headings, bold, italic, strikethrough, inline code, links', () => {
  assert.equal(markdownToWiki('# Title'), 'h1. Title')
  assert.equal(markdownToWiki('### Sub'), 'h3. Sub')
  assert.equal(markdownToWiki('a **bold** b'), 'a *bold* b')
  assert.equal(markdownToWiki('a __bold__ b'), 'a *bold* b')
  assert.equal(markdownToWiki('a *em* b'), 'a _em_ b')
  assert.equal(markdownToWiki('a ~~gone~~ b'), 'a -gone- b')
  assert.equal(markdownToWiki('use `x = 1` here'), 'use {{x = 1}} here')
  assert.equal(markdownToWiki('see [docs](https://example.test/a)'), 'see [docs|https://example.test/a]')
})

test('code content, snake_case and arithmetic asterisks are left alone', () => {
  assert.equal(markdownToWiki('`**not bold**`'), '{{**not bold**}}')
  assert.equal(markdownToWiki('my_var_name stays'), 'my_var_name stays')
  assert.equal(markdownToWiki('5 * 3 = 15'), '5 * 3 = 15')
})

test('bullet, numbered and nested lists, checklists', () => {
  assert.equal(markdownToWiki('- a\n- b\n  - c'), '* a\n* b\n** c')
  assert.equal(markdownToWiki('* a\n+ b'), '* a\n* b')
  assert.equal(markdownToWiki('1. one\n2. two\n  1. nested'), '# one\n# two\n## nested')
  assert.equal(markdownToWiki('- [ ] todo\n- [x] done'), '* (x) todo\n* (/) done')
})

test('tables become wiki tables with a header row', () => {
  const md = '| Name | Value |\n|------|-------|\n| a | **1** |\n| b | 2 |'
  assert.equal(markdownToWiki(md), '||Name||Value||\n|a|*1*|\n|b|2|')
})

test('fenced code blocks are preserved verbatim', () => {
  const md = 'before\n```js\nconst **x** = `y`;\n```\nafter'
  assert.equal(markdownToWiki(md), 'before\n{code:js}\nconst **x** = `y`;\n{code}\nafter')
  assert.equal(markdownToWiki('```\nplain\n```'), '{code}\nplain\n{code}')
})

test('blockquote and horizontal rule', () => {
  assert.equal(markdownToWiki('> note'), 'bq. note')
  assert.equal(markdownToWiki('---'), '----')
})

test('plain text and empty input pass through', () => {
  assert.equal(markdownToWiki('Just a sentence.'), 'Just a sentence.')
  assert.equal(markdownToWiki(''), '')
  assert.equal(markdownToWiki(undefined), undefined)
})

test('a realistic acceptance-criteria block renders as sections, a list and a table', () => {
  const md = [
    '## Acceptance criteria',
    '- User can log in with **email**',
    '- [ ] Error shown on wrong password',
    '',
    '| Case | Result |',
    '|---|---|',
    '| valid | `200` |',
  ].join('\n')
  assert.equal(markdownToWiki(md), [
    'h2. Acceptance criteria',
    '* User can log in with *email*',
    '* (x) Error shown on wrong password',
    '',
    '||Case||Result||',
    '|valid|{{200}}|',
  ].join('\n'))
})
