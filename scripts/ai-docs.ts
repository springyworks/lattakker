import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { transformWithOxc, type Plugin } from 'vite';
import { parseDirectives, renderDirectives } from '../src/ai/directives';
import { mmsGuide, rulesChapter } from '../src/ai/readmeSections';
import { placedInLab } from '../src/labLayout';

/**
 * Documents for AI helpers, published next to the page as ordinary files (and served by the dev server):
 *
 *   ai/index.md         what exists and where
 *   ai/rules.md         the rules (chapter 11.5 of the README: the built-in helper reads the same text)
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

/** Imports the data sources may use (the Lab demos need the layout moves). */
const IMPORTS: Record<string, unknown> = { placedInLab };

/** Reads `export const NAME = value` out of a TypeScript source file: types are stripped, known imports are provided, nothing else is compiled. */
export async function evalConst(path: string, name: string): Promise<unknown> {
  const { code: js } = await transformWithOxc(readFileSync(path, 'utf8'), path, { lang: 'ts' });
  const code = js.replace(/^import\s[^;]*;?\s*$/gm, '').replace(/^export\s+(default\s+)?/gm, '');
  return runInNewContext(`${code}\n${name}`, { ...IMPORTS }, { timeout: 5000 });
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

export async function buildDocs(root: string, site: string): Promise<AiDoc[]> {
  const read = (p: string): string => readFileSync(join(root, p), 'utf8');
  // Links between these files: absolute on the published site, plain file names when read from the files themselves.
  const at = (file: string): string => (site ? `${site}ai/${file}` : file);
  const fill = (text: string): string => text.replaceAll(`${PAGES}ai/`, site ? `${site}ai/` : '');
  const api = String(await evalConst(join(root, 'src/sheet/apiTypes.ts'), 'CELL_API_DTS')).trim();
  const examples = (await evalConst(join(root, 'src/examples.ts'), 'EXAMPLES')) as Array<[string, string]>;
  const demos = (await evalConst(join(root, 'src/labDemos.ts'), 'LAB_DEMOS')) as Array<[string, string]>;
  const monitor = (await evalConst(join(root, 'src/monitorDemos.ts'), 'MONITOR_DEMOS')) as Array<[string, string]>;
  // The standing directives are part of the rules every AI reads first. The end dates stay in the text, so a copy that is read late can still be judged.
  const directives = renderDirectives(parseDirectives(JSON.parse(read('ai-docs/directives.json'))));
  const readme = read('README.md');
  // The rules are chapter 11.5 of the README: one home. As a file of their own they are headed "##" so the sections read like before.
  const chapter = rulesChapter(readme).replace(/^#### (?:\d+(?:\.\d+)*\s+)?/gm, '## ');
  const rules = fill(`# Rules for AI helpers of Lattakker Sheet\n\n${chapter}`) + (directives ? `\n\n## Standing directives\n\n${directives}\n` : '');

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

/** GitHub's anchor for a heading: lower case, only letters, digits, spaces and hyphens, spaces made hyphens. */
export const anchor = (heading: string): string => heading.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').trim().replace(/ /g, '-');

/**
 * /llms.txt, the front door for AIs that can open links: made from the README (its first paragraph, its table of
 * contents and its guide to the window.mms console), so there is no text of its own to keep up to date.
 */
export function llmsTxt(readme: string, site: string): string {
  const pages = site || PAGES;
  const intro = (readme.split(/\n\s*\n/).find((p, i) => i > 0 && p.trim() && !p.startsWith('#') && !p.startsWith('>')) ?? '').replace(/\s*\n\s*/g, ' ').trim();
  const contents = [...readme.matchAll(/^(##|###) (\d+(?:\.\d+)* .+)$/gm)].filter((m) => !/^\d+\.\d+\.\d+/.test(m[2])).map((m) => `${m[1] === '###' ? '  ' : ''}- [${m[2]}](${BLOB}README.md#${anchor(`${m[2]}`)})`);
  return [
    '# Lattakker Sheet',
    '',
    `> ${intro}`,
    '',
    '## Step zero: the README is the place of truth',
    '',
    `Before you do anything else, read ${BLOB}README.md (raw text: ${RAW}README.md; the same text next to the live page: ${pages}ai/README.md). It wins over what you remember or guess. If you cannot open links, call the tool \`read_readme\` (it fetches the README for you, part by part) or \`confirm_readme\` with one sentence on what you learned. An AI that comes in over /mcp or WebMCP has its first call answered with the rules until it has done one of those. Everything is made from that README: the rules are its chapter 11.5, the exact API is chapter 8.22, this file is cut out of it.`,
    '',
    '## Files made from the README and the code',
    '',
    `- [${pages}ai/index.md](${pages}ai/index.md): what exists and where`,
    `- [${pages}ai/rules.md](${pages}ai/rules.md): the rules (README chapter 11.5)`,
    `- [${pages}ai/cell-api.d.ts](${pages}ai/cell-api.d.ts): the API as TypeScript declarations (README chapter 8.22)`,
    `- [${pages}ai/examples.md](${pages}ai/examples.md) and [${pages}ai/lab-demos.md](${pages}ai/lab-demos.md): every example cell`,
    `- [${pages}ai/everything.md](${pages}ai/everything.md): all of it in one file`,
    '',
    '## The README, chapter by chapter',
    '',
    ...contents,
    '',
    '## The window.mms console (README 11.3.5 and 11.3.6)',
    '',
    mmsGuide(readme),
    '',
  ].join('\n');
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
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        const prefix = `${base.replace(/\/$/, '')}/ai/`;
        if (path === `${base.replace(/\/$/, '')}/llms.txt`) {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(llmsTxt(readFileSync(join(root, 'README.md'), 'utf8'), site()));
          return;
        }
        if (!path.startsWith(prefix)) return next();
        try {
          const doc = (await buildDocs(root, site())).find((d) => d.file === decodeURIComponent(path.slice(prefix.length)));
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
    async generateBundle() {
      for (const doc of await buildDocs(root, site())) this.emitFile({ type: 'asset', fileName: `ai/${doc.file}`, source: doc.body });
      this.emitFile({ type: 'asset', fileName: 'llms.txt', source: llmsTxt(readFileSync(join(root, 'README.md'), 'utf8'), site()) });
    },
  };
}
