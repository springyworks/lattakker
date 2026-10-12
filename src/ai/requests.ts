/** Chat by comments: the player writes `// AI: ...` (or a plain `//` line under an earlier answer), the assistant answers with `// ↳ AI: ...` lines right below. */
export const REPLY_MARK = '// ↳';

// "// AI: question", "//ai", "// help" ...: the word on its own (or followed by a colon, comma or text) starts a request.
const EXPLICIT = /^\s*\/\/\s*(?:@ai|ai|help)(?![\w-])\s*[:,]?\s*(.*)$/i;
const NO_QUESTION = 'Please look at my code here and help me.';
const PLAIN_COMMENT = /^\s*\/\/\s*(\S.*)$/;

/** The question on line `i` (0-based), or null when that line is not a question. */
export function requestAt(lines: string[], i: number): string | null {
  const line = lines[i] ?? '';
  if (line.trimStart().startsWith(REPLY_MARK)) return null;
  const explicit = EXPLICIT.exec(line);
  if (explicit) return explicit[1].trim() || NO_QUESTION;
  const plain = PLAIN_COMMENT.exec(line);
  if (plain && i > 0 && lines[i - 1].trimStart().startsWith(REPLY_MARK)) return plain[1].trim();
  return null;
}

export function isAnswered(lines: string[], i: number): boolean {
  return (lines[i + 1] ?? '').trimStart().startsWith(REPLY_MARK);
}

/** Wraps an answer into `// ↳` comment lines and prepares an empty `// ` line for the player's next message. */
export function replyBlock(reply: string): string {
  const words = reply.replace(/\s+/g, ' ').split(' ');
  const rows: string[] = [];
  let row = '';
  for (const w of words) {
    if (row && row.length + w.length + 1 > 70) {
      rows.push(row);
      row = w;
    } else row = row ? row + ' ' + w : w;
  }
  if (row) rows.push(row);
  const lines = rows.map((r, i) => (i === 0 ? `${REPLY_MARK} AI: ${r}` : `${REPLY_MARK}    ${r}`));
  return [...lines, '// '].join('\n');
}
