/**
 * @fileoverview Markdown → Jira wiki markup. Jira Server does not render
 * Markdown, so a description written the way an agent naturally writes it
 * shows up as noise (literal `**`, `|---|` rows, `- [ ]`). This converts the
 * subset the skills actually emit: headings, bold/italic/strikethrough,
 * inline and fenced code, nested bullet and numbered lists, checklists,
 * tables, links, blockquotes and horizontal rules. It is NOT a general
 * Markdown engine (SPEC §4.4) — anything else passes through unchanged.
 *
 * Pass `description_format="wiki"` to the tools to skip this entirely.
 */

const SENTINEL = '\u0001'

/**
 * Convert a Markdown string to Jira wiki markup.
 *
 * @param {string} md
 * @returns {string}
 */
export function markdownToWiki(md) {
  if (!md) return md
  const text = String(md).replaceAll('\r\n', '\n')

  // Fenced code blocks are lifted out first so nothing inside them is touched.
  const blocks = []
  const withoutBlocks = text.replace(/```([\w+#.-]*)[ \t]*\n([\s\S]*?)```/g, (_, lang, code) => {
    const tag = lang ? `{code:${lang}}` : '{code}'
    blocks.push(`${tag}\n${code.replace(/\n$/, '')}\n{code}`)
    return `${SENTINEL}K${blocks.length - 1}${SENTINEL}`
  })

  const lines = withoutBlocks.split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      out.push(`||${splitRow(line).map(inline).join('||')}||`)
      i += 2
      while (i < lines.length && isTableRow(lines[i])) {
        out.push(`|${splitRow(lines[i]).map(inline).join('|')}|`)
        i += 1
      }
      continue
    }
    out.push(convertLine(line))
    i += 1
  }

  return out.join('\n').replace(new RegExp(`${SENTINEL}K(\\d+)${SENTINEL}`, 'g'), (_, n) => blocks[Number(n)])
}

/** @param {string} line */
function isTableRow(line) {
  return /^\s*\|.*\|\s*$/.test(line)
}

/** @param {string} line */
function isTableSeparator(line) {
  return /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(line)
}

/** @param {string} line */
function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

/**
 * Block-level conversion of one line (everything except tables and code).
 *
 * @param {string} line
 * @returns {string}
 */
function convertLine(line) {
  if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return '----'

  const heading = line.match(/^(#{1,6})\s+(.*)$/)
  if (heading) return `h${heading[1].length}. ${inline(heading[2])}`

  const quote = line.match(/^>\s?(.*)$/)
  if (quote) return `bq. ${inline(quote[1])}`

  const checkbox = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/)
  if (checkbox) {
    const depth = Math.floor(checkbox[1].length / 2) + 1
    const icon = checkbox[2] === ' ' ? '(x)' : '(/)'
    return `${'*'.repeat(depth)} ${icon} ${inline(checkbox[3])}`
  }

  const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/)
  if (bullet) {
    const depth = Math.floor(bullet[1].length / 2) + 1
    return `${'*'.repeat(depth)} ${inline(bullet[2])}`
  }

  const numbered = line.match(/^(\s*)\d+[.)]\s+(.*)$/)
  if (numbered) {
    const depth = Math.floor(numbered[1].length / 2) + 1
    return `${'#'.repeat(depth)} ${inline(numbered[2])}`
  }

  return inline(line)
}

/**
 * Inline conversion: code, links, bold, italic, strikethrough.
 * Bold is parked behind a sentinel so the italic pass cannot eat it.
 *
 * @param {string} s
 * @returns {string}
 */
function inline(s) {
  const codes = []
  let t = s.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`{{${code}}}`)
    return `${SENTINEL}C${codes.length - 1}${SENTINEL}`
  })
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '[$1|$2]')
  t = t.replace(/\*\*(.+?)\*\*/g, `${SENTINEL}B$1${SENTINEL}B`)
  t = t.replace(/__(.+?)__/g, `${SENTINEL}B$1${SENTINEL}B`)
  // Markdown italic `*x*` → wiki italic `_x_` (an underscore italic is already wiki syntax).
  t = t.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?=[^*\w]|$)/g, '$1_$2_')
  t = t.replace(/~~(.+?)~~/g, '-$1-')
  t = t.replace(new RegExp(`${SENTINEL}B(.+?)${SENTINEL}B`, 'g'), '*$1*')
  return t.replace(new RegExp(`${SENTINEL}C(\\d+)${SENTINEL}`, 'g'), (_, n) => codes[Number(n)])
}
