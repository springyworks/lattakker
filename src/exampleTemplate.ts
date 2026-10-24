/**
 * The starting text of a "create an example here" cell: a free-form page to fill in. It is written the way the
 * shipped examples are (a plain-words comment above every group of lines, an empty line after each group), so
 * the habit comes with it.
 */
export function exampleTemplate(cols: number, rows: number): string {
  return `// My example: replace this line with a title for it.
// Say in plain words what it should do, then build it step by step below.

/** Make the block big enough to see the code and what it shows. */
span(${cols}, ${rows})

/** Step 1: say hello. Change the words between the quotes. */
show('Hello! This is my own example.')

// Step 2: your idea goes here. Tip: hover over any word to learn what it does,
// and press Ctrl+Enter to run the cell again.
`;
}
