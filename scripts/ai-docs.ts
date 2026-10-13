import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { Plugin } from 'vite';

/**
 * Documents for AI helpers, published next to the page as ordinary files (and served by the dev server):
 *
 *   ai/index.md         what exists and where
 *   ai/rules.md         the rules (ai-docs/rules.md: the built-in helper reads the same file)
 *   ai/cell-api.d.ts    the TypeScript declarations of everything a cell can use
 *   ai/examples.md      every example cell of the game board, with its comments
 *   ai/lab-demos.md     every demo cell of the Lab
 *   ai/README.md        the README of the project
 *   ai/everything.md    all of it in one file
 *   ai/manifest.json    the same list for programs
 *
 * They are made from the real sources (src/sheet/apiTypes.ts, src/examples.ts, src/labDemos.ts, README.md), so
 * they cannot drift from the code the children actually play with.
 */

const REPO = 'springyworks/lattakker';
const BRANCH = 'main';
export const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
export const BLOB = `https://github.com/${REPO}/blob/${BRANCH}/`;
const PAGES = 'https://springyworks.github.io/lattakker/';

export interface AiDoc {
  file: string;
  type: string;
  title: string;
  description: string;
  body: string;
}

/** Reads `export const NAME ... = value` out of a TypeScript source file without compiling it (the sources are plain data). */
function evalConst(path: string, name: string): unknown {
  const text = readFileSync(path, 'utf8');
  const code = text.replace(new RegExp(`export const ${name}\\s*(?::[^=]+)?=`), `const ${name} =`);
  return runInNewContext(`${code}\n${name}`, {}, { timeout: 5000 });
}

const FENCE = '````';

/** The first comment line of a cell: what it is about. */
function titleOf(code: string): string {
  const line = code.split('\n').map((l) => l.trim()).find((l) => l.startsWith('//') && l.replace(/^\/\/\s*/, '').length > 2);
  const text = (line ?? '').replace(/^\/\/\s*/, '');
  return text.length > 90 ? `${text.slice(0, 89)}…` : text;
}

function cellsDoc(heading: string, intro: string, tab: string, cells: Array<[string, string]>): string {
  const parts = [`# ${heading}`, '', intro, ''];
  for (const [address, code] of cells) {
    const title = titleOf(code);
    parts.push(`## /${tab}/${address}${title ? ` — ${title}` : ''}`, '', `${FENCE}ts`, code.trimEnd(), FENCE, '');
  }
  return parts.join('\n');
}

export function buildDocs(root: string, site: string): AiDoc[] {
  const read = (p: string): string => readFileSync(join(root, p), 'utf8');
  // Links between these files: absolute on the published site, plain file names when read from the files themselves.
  const at = (file: string): string => (site ? `${site}ai/${file}` : file);
  const fill = (text: string): string => text.replaceAll('{{SITE}}ai/', site ? `${site}ai/` : '').replaceAll('{{GITHUB_README}}', `${BLOB}README.md`);
  const api = String(evalConst(join(root, 'src/sheet/apiTypes.ts'), 'CELL_API_DTS')).trim();
  const examples = evalConst(join(root, 'src/examples.ts'), 'EXAMPLES') as Array<[string, string]>;
  const demos = evalConst(join(root, 'src/labDemos.ts'), 'LAB_DEMOS') as Array<[string, string]>;
  const monitor = evalConst(join(root, 'src/monitorDemos.ts'), 'MONITOR_DEMOS') as Array<[string, string]>;
  const rules = fill(read('ai-docs/rules.md'));
  const readme = read('README.md');

  const apiFile = `// Lattakker Sheet: everything a cell's TypeScript can use, as declarations. Generated from src/sheet/apiTypes.ts.\n// Cells are top-level scripts (no return, top-level await works). See rules.md.\n${api}\n`;
  const examplesFile = cellsDoc('Example cells: the Game board tab', `These are the cells the children start with on the Game board (paths /board/A12 ...). Each one is plain TypeScript with comments that explain it. Copy their style. Generated from src/examples.ts.`, 'board', examples);
  const demosFile = cellsDoc('Demo cells: the Lab tab', `Live demos of the Lab (paths /lab/A16 ...): plots, animations, grids, inputs, MCP, weather, the model on this computer. Generated from src/labDemos.ts.`, 'lab', demos) +
    '\n' +
    cellsDoc('Demo cells: the Monitor tab', `The Monitor tab (paths /monitor/A1 ...): the router drawing animated from the live MCP traffic (svg, mcp.tap), graphs of this computer (system), router messages per second, the weather. Generated from src/monitorDemos.ts.`, 'monitor', monitor);

  const docs: AiDoc[] = [
    { file: 'rules.md', type: 'text/markdown', title: 'Rules for AI helpers', description: 'How to behave with children, how to work like a coder, the rules of cell code.', body: rules },
    { file: 'cell-api.d.ts', type: 'text/plain', title: 'The cell code API', description: 'TypeScript declarations of print, plot, grid, at, on, every, game, input, mcp ... everything a cell can use.', body: apiFile },
    { file: 'examples.md', type: 'text/markdown', title: 'Example cells (Game board)', description: `${examples.length} cells of TypeScript with comments: the starting point of the children.`, body: examplesFile },
    { file: 'lab-demos.md', type: 'text/markdown', title: 'Demo cells (Lab)', description: `${demos.length + monitor.length} live demos: plots, animation, animated SVG, grids, inputs, MCP, weather, a local model, system graphs.`, body: demosFile },
    { file: 'README.md', type: 'text/markdown', title: 'README', description: 'The whole documentation of the project (same as the one on GitHub).', body: readme },
  ];

  const sources = [
    ['README.md', 'The README'],
    ['src/sheet/apiTypes.ts', 'The API typings (source of cell-api.d.ts)'],
    ['src/examples.ts', 'The example cells (source of examples.md)'],
    ['src/labDemos.ts', 'The Lab demo cells (source of lab-demos.md)'],
    ['src/monitorDemos.ts', 'The Monitor demo cells (also in lab-demos.md)'],
    ['src/sheet/api.ts', 'How the API is implemented'],
    ['public/llms.txt', 'The short guide for AI assistants'],
  ];
  const index = [
    '# Lattakker Sheet: documents for AI helpers',
    '',
    'A spreadsheet of small TypeScript programs (cells) that also holds a board game, for children learning to program. These files are made from the real sources, so they match the code the children play with. Read them like a human coder reads a project: rules, then the API, then examples.',
    '',
    '| File | What it is |',
    '| --- | --- |',
    ...docs.map((d) => `| [${d.file}](${at(d.file)}) | ${d.description} |`),
    `| [everything.md](${at('everything.md')}) | All of the above in one file. |`,
    `| [manifest.json](${at('manifest.json')}) | The same list for programs. |`,
    '',
    '## The same things on GitHub (the source files)',
    '',
    ...sources.map(([path, what]) => `- ${what}: ${BLOB}${path} (raw: ${RAW}${path})`),
    '',
    '## How to use them',
    '',
    '1. Read rules.md first.',
    '2. Look up exact names and signatures in cell-api.d.ts.',
    '3. Find a similar example in examples.md or lab-demos.md and follow its style; the headings are cell paths you can open (/lab/A16).',
    '4. Write, run, read the error, fix that error.',
    '',
  ].join('\n');

  const everything = [index, rules, `# The cell code API\n\n${FENCE}ts\n${api}\n${FENCE}\n`, examplesFile, demosFile, readme].join('\n\n---\n\n');
  const manifest = JSON.stringify(
    {
      app: 'lattakker-ai-docs',
      site: site || null,
      github: { repo: `https://github.com/${REPO}`, readme: `${BLOB}README.md`, rawBase: RAW },
      docs: [
        { file: 'index.md', title: 'Index', description: 'What exists and where.' },
        ...docs.map((d) => ({ file: d.file, title: d.title, description: d.description, bytes: Buffer.byteLength(d.body) })),
        { file: 'everything.md', title: 'Everything in one file', description: 'Index, rules, API, examples, demos and README.', bytes: Buffer.byteLength(everything) },
      ].map((d) => ({ ...d, url: at(d.file) })),
      sources: sources.map(([path, what]) => ({ path, what, blob: `${BLOB}${path}`, raw: `${RAW}${path}` })),
    },
    null,
    2,
  );
  return [
    { file: 'index.md', type: 'text/markdown', title: 'Index', description: 'What exists and where.', body: index },
    ...docs,
    { file: 'everything.md', type: 'text/markdown', title: 'Everything in one file', description: 'All documents together.', body: everything },
    { file: 'manifest.json', type: 'application/json', title: 'Manifest', description: 'The list for programs.', body: manifest },
  ];
}

export function aiDocs(): Plugin {
  let root = process.cwd();
  let base = '/';
  const site = (): string => (process.env.GITHUB_PAGES ? PAGES : '');
  return {
    name: 'lattakker-ai-docs',
    configResolved(config) {
      root = config.root;
      base = config.base;
    },
    // Made fresh at every request, so an edited example shows up without restarting the server.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        const prefix = `${base.replace(/\/$/, '')}/ai/`;
        if (!path.startsWith(prefix)) return next();
        try {
          const doc = buildDocs(root, site()).find((d) => d.file === decodeURIComponent(path.slice(prefix.length)));
          if (!doc) return next();
          res.setHeader('Content-Type', `${doc.type}; charset=utf-8`);
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(doc.body);
        } catch (err) {
          res.statusCode = 500;
          res.end(`could not build the AI documents: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    },
    generateBundle() {
      for (const doc of buildDocs(root, site())) this.emitFile({ type: 'asset', fileName: `ai/${doc.file}`, source: doc.body });
    },
  };
}
