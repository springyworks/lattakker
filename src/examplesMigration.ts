import type { Sheet } from './sheet/Sheet';

/**
 * Examples change between versions, but the page only loads them into a sheet that has never been used.
 * Someone who comes back with saved cells would never see the new ones. This brings them in, carefully:
 *
 *  - an example that was ADDED is put into its cell only if that cell is still empty;
 *  - an example that was CHANGED replaces the old one only if the cell still holds exactly the old
 *    shipped code (comments aside), which means nobody edited it.
 *
 * Anything a person wrote is never touched. It runs once per revision (the number is kept in this browser).
 */

const KEY = 'lattakker:examples-rev';
export const EXAMPLES_REV = 17;

/** Examples that a revision took out, per tab: the cell is emptied only if it still holds exactly the old shipped code. A function is asked when the migration runs (the code may live elsewhere). */
const REMOVED: Record<number, { lab: Record<string, string[] | (() => string[])> }> = {
  // 17: the ASR-33 terminal moved from the Lab's R50 to its top left corner, A1 (labLayout.ts puts the new one there).
  17: { lab: { R50: () => [16, 15, 14].flatMap((rev) => REPLACED[rev]?.lab.R50 ?? []) } },
  16: {
    lab: {
      R41: [
        "span(9, 8)\npaper({ font: 'tty33', speed: 10 })\nconst lines = [\n'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG 0123456789',\n'10 PRINT \"HELLO, WORLD\"',\n'20 GOTO 10',\n'READY.',\n'A BOX OF MY RED WINE BEAT A QUICK FEW GREEN JUGS',\n]\nclear()\nprint('LATTAKKER  ASR-33  TELETYPE  READY')\nprint('')\nlet n = 0\nevery('8s', async () => {\nconst time = new Date().toTimeString().slice(0, 8)\nlet text = lines[n % lines.length]\nif (n % 3 === 2) {\ntry {\ntext = (await system.text()).replace(/\\s+/g, ' ')\n} catch {\ntext = 'NO READING FROM THE COMPUTER'\n}\n}\nn++\nprint(time + '  ' + text.toUpperCase())\n})",
      ],
    },
  },
};

/** What each revision added, per tab. */
const ADDED: Record<number, { board: string[]; lab: string[] }> = {
  2: { board: ['A42', 'G42', 'M42', 'Q42', 'U42'], lab: ['A31', 'G31'] },
  3: { board: [], lab: ['A35', 'J35', 'R35', 'A41', 'J41'] },
  4: { board: [], lab: ['A47'] },
  5: { board: [], lab: ['A53', 'K53'] },
  6: { board: ['A45', 'K45'], lab: [] },
  7: { board: ['A51'], lab: [] },
  8: { board: [], lab: [] },
  9: { board: ['K51'], lab: [] },
  10: { board: [], lab: [] },
  11: { board: [], lab: [] },
  12: { board: [], lab: ['R41'] },
  13: { board: [], lab: ['R50'] },
};

/** The code (without its comments) that an example had before a revision replaced it. */
const REPLACED: Record<number, { board: Record<string, string[]>; lab: Record<string, string[]> }> = {
  // 16: Lab R50 no longer points at R41, which was removed.
  16: { board: {}, lab: { R50: ["span(9, 8)\nconst LIT = '#f5f4ef'\nconst DIM = '#deddd5'\npaper({ font: 'tty33', speed: 20, tint: DIM })\nconst PROMPT = '>> '\nconst ROLL = 4000\nconst WORDS = ['THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG 0123456789', '10 PRINT \"HELLO, WORLD\"', '20 GOTO 10', 'READY.']\nlet text = ''\nconst put = (more: string): void => {\ntext += more\nshow(text)\n}\ntype Command = { help: string; run: (arg: string) => string | Promise<string> }\nlet chatting: Array<{ role: 'user' | 'assistant'; content: string }> | null = null\nconst hits = async (word: string): Promise<string[]> => {\nconst found: string[] = []\nfor (const t of tabs.list()) {\ntry {\nfor (const c of await mcp.list(t.id)) if ((c.code + ' ' + c.text).toLowerCase().includes(word.toLowerCase())) found.push(c.path)\n} catch {\n}\n}\nreturn found\n}\nconst commands: Record<string, Command> = {\nH: { help: 'THIS LIST', run: () => helpText() },\nSTATUS: {\nhelp: 'TABS, ROUTER, MODEL',\nrun: async () => {\nconst t = tabs.list()\nconst s = mcp.stats()\nconst o = await ollama.status()\nreturn [\n'TABS     ' + t.map((x) => x.id + ':' + x.cells).join(' '),\n'ROUTER   ' + s.messages + ' MSGS, ' + s.errors + ' ERRORS, ' + s.ratePerSecond.toFixed(1) + '/S',\n'SERVERS  ' + s.serverCount + ', LISTENERS ' + s.listeners,\n'MODEL    ' + (o.running ? o.selected : 'NOT RUNNING'),\n'UP       ' + Math.round(s.uptimeSeconds) + ' S',\n].join('\\n')\n},\n},\nMCP: { help: 'SERVERS AND THE BUSIEST', run: () => 'SERVERS ' + mcp.servers().join(' ') + '\\nBUSIEST ' + mcp.stats().servers.slice(0, 3).map((x) => x.name + ' ' + x.requests).join(', ') },\nSYSTEM: { help: 'CPU, MEMORY, TEMPERATURES', run: () => system.text() },\nTIME: { help: 'THE TIME', run: () => new Date().toTimeString().slice(0, 8) + '  ' + new Date().toDateString() },\nFIND: {\nhelp: 'FIND <WORD> IN ALL CELLS',\nrun: async (word) => {\nif (!word) return 'FIND WHAT?'\nconst found = await hits(word)\nif (!found.length) return 'NOTHING FOUND'\nreturn found.slice(0, 8).join('\\n') + (found.length > 8 ? '\\n+' + (found.length - 8) + ' MORE' : '') + '\\nGO <PATH> TAKES YOU THERE'\n},\n},\nGO: {\nhelp: 'GO /LAB/R41  ZOOM TO A CELL',\nrun: async (path) => {\nconst m = /^\\/?([a-z0-9-]+)\\/([a-z]+\\d+)$/i.exec(path.trim())\nif (!m) return 'GO /LAB/R41'\ntabs.select(m[1].toLowerCase())\nawait mcp.tool(m[1].toLowerCase(), 'zoom', { address: m[2].toUpperCase() })\nreturn 'THERE: /' + m[1] + '/' + m[2]\n},\n},\nASK: {\nhelp: 'ASK <QUESTION> OF THE MODEL',\nrun: async (question) => {\nif (!question) return 'ASK WHAT?'\nput('ONE MOMENT...\\n')\nreturn ollama.ask(question + ' (answer in at most three short lines)')\n},\n},\nCHAT: { help: 'TALK WITH THE MODEL, BYE ENDS', run: () => { chatting = []; return 'LINE OPEN. TYPE BYE TO CLOSE IT.' } },\nDEMO: { help: 'WHAT THE MACHINE TYPES', run: () => WORDS.join('\\n') },\nTTY: { help: 'CR, LF, BACKSPACE AT WORK', run: () => 'LF ONLY, STEPS:\\nA\\vB\\vC\\vD\\nCR ONLY, BB OVER AAAA:\\nAAAA\\rBB\\nBACKSPACE, X OVER B:\\nABC\\b\\bX' },\nCLEAR: { help: 'A FRESH ROLL', run: () => { clear(); text = ''; return 'NEW ROLL' } },\n}\nconst alias: Record<string, string> = { HELP: 'H', '?': 'H' }\nconst helpText = (): string => Object.entries(commands).map(([name, c]) => name.padEnd(7) + c.help).join('\\n')\nconst answer = async (line: string): Promise<string> => {\nif (!line) return ''\nif (chatting) {\nif (/^(bye|exit|quit)$/i.test(line)) {\nchatting = null\nreturn 'LINE CLOSED.'\n}\nchatting.push({ role: 'user', content: line })\nconst said = await ollama.chat(chatting)\nchatting.push({ role: 'assistant', content: said })\nreturn said\n}\nconst [word, ...rest] = line.split(/\\s+/)\nconst command = commands[alias[word.toUpperCase()] ?? word.toUpperCase()]\nif (!command) return '?? ' + word.toUpperCase() + '  WHAT? I KNOW:\\n' + helpText()\nreturn command.run(rest.join(' '))\n}\nlet keys = false\nlet busy = false\nlet buf = ''\nconst enter = async (): Promise<void> => {\nconst line = buf.trim()\nbuf = ''\nput('\\n')\nbusy = true\ntry {\nconst said = await answer(line)\nif (said) put(said.toUpperCase() + '\\n')\n} catch (e) {\nput('?? ' + String((e as Error).message ?? e).toUpperCase() + '\\n')\n}\nbusy = false\nif (text.length > ROLL) {\nclear()\ntext = 'NEW ROLL\\n'\n}\nput(PROMPT)\n}\nlet give = (): void => {}\nconst hold = (on: boolean): void => {\nkeys = on\npaper({ font: 'tty33', speed: 20, tint: on ? LIT : DIM })\n}\non(cell, 'click', () => {\nif (!keys) teletype.bell()\ngive()\ngive = input.claimKeys(() => hold(false))\nhold(true)\n})\ninput.onKey(async (key, info) => {\nif (!keys || busy || info.ctrl || info.alt) return\nif (key === 'Escape') {\nhold(false)\ngive()\n} else if (key === 'Enter') await enter()\nelse if (key === 'Backspace') {\nif (buf) put('\\b')\nbuf = buf.slice(0, -1)\n} else {\nconst ch = key === 'Space' ? ' ' : key.length === 1 ? (info.shift ? key.toUpperCase() : key) : ''\nif (!ch) return\nbuf += ch\nput(ch.toUpperCase())\n}\n})\nclear()\nput('LATTAKKER  ASR-33  TERMINAL\\nCLICK THE PAPER, THEN TYPE.  H = HELP.  ESC = KEYBOARD OFF.  DARK PAPER = NO KEYBOARD.\\n\\n' + PROMPT)"] } },
  // 15: Lab R50 shows whether it has the keyboard: the paper is a little darker while it has not (Enter then opens the editor like on any cell).
  15: { board: {}, lab: { R50: ["span(9, 8)\npaper({ font: 'tty33', speed: 20 })\nconst PROMPT = '>> '\nconst ROLL = 4000\nconst WORDS = ['THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG 0123456789', '10 PRINT \"HELLO, WORLD\"', '20 GOTO 10', 'READY.']\nlet text = ''\nconst put = (more: string): void => {\ntext += more\nshow(text)\n}\ntype Command = { help: string; run: (arg: string) => string | Promise<string> }\nlet chatting: Array<{ role: 'user' | 'assistant'; content: string }> | null = null\nconst hits = async (word: string): Promise<string[]> => {\nconst found: string[] = []\nfor (const t of tabs.list()) {\ntry {\nfor (const c of await mcp.list(t.id)) if ((c.code + ' ' + c.text).toLowerCase().includes(word.toLowerCase())) found.push(c.path)\n} catch {\n}\n}\nreturn found\n}\nconst commands: Record<string, Command> = {\nH: { help: 'THIS LIST', run: () => helpText() },\nSTATUS: {\nhelp: 'TABS, ROUTER, MODEL',\nrun: async () => {\nconst t = tabs.list()\nconst s = mcp.stats()\nconst o = await ollama.status()\nreturn [\n'TABS     ' + t.map((x) => x.id + ':' + x.cells).join(' '),\n'ROUTER   ' + s.messages + ' MSGS, ' + s.errors + ' ERRORS, ' + s.ratePerSecond.toFixed(1) + '/S',\n'SERVERS  ' + s.serverCount + ', LISTENERS ' + s.listeners,\n'MODEL    ' + (o.running ? o.selected : 'NOT RUNNING'),\n'UP       ' + Math.round(s.uptimeSeconds) + ' S',\n].join('\\n')\n},\n},\nMCP: { help: 'SERVERS AND THE BUSIEST', run: () => 'SERVERS ' + mcp.servers().join(' ') + '\\nBUSIEST ' + mcp.stats().servers.slice(0, 3).map((x) => x.name + ' ' + x.requests).join(', ') },\nSYSTEM: { help: 'CPU, MEMORY, TEMPERATURES', run: () => system.text() },\nTIME: { help: 'THE TIME', run: () => new Date().toTimeString().slice(0, 8) + '  ' + new Date().toDateString() },\nFIND: {\nhelp: 'FIND <WORD> IN ALL CELLS',\nrun: async (word) => {\nif (!word) return 'FIND WHAT?'\nconst found = await hits(word)\nif (!found.length) return 'NOTHING FOUND'\nreturn found.slice(0, 8).join('\\n') + (found.length > 8 ? '\\n+' + (found.length - 8) + ' MORE' : '') + '\\nGO <PATH> TAKES YOU THERE'\n},\n},\nGO: {\nhelp: 'GO /LAB/R41  ZOOM TO A CELL',\nrun: async (path) => {\nconst m = /^\\/?([a-z0-9-]+)\\/([a-z]+\\d+)$/i.exec(path.trim())\nif (!m) return 'GO /LAB/R41'\ntabs.select(m[1].toLowerCase())\nawait mcp.tool(m[1].toLowerCase(), 'zoom', { address: m[2].toUpperCase() })\nreturn 'THERE: /' + m[1] + '/' + m[2]\n},\n},\nASK: {\nhelp: 'ASK <QUESTION> OF THE MODEL',\nrun: async (question) => {\nif (!question) return 'ASK WHAT?'\nput('ONE MOMENT...\\n')\nreturn ollama.ask(question + ' (answer in at most three short lines)')\n},\n},\nCHAT: { help: 'TALK WITH THE MODEL, BYE ENDS', run: () => { chatting = []; return 'LINE OPEN. TYPE BYE TO CLOSE IT.' } },\nDEMO: { help: 'WHAT THE MACHINE TYPES', run: () => WORDS.join('\\n') },\nTTY: { help: 'CR, LF, BACKSPACE AT WORK', run: () => 'LF ONLY, STEPS:\\nA\\vB\\vC\\vD\\nCR ONLY, BB OVER AAAA:\\nAAAA\\rBB\\nBACKSPACE, X OVER B:\\nABC\\b\\bX' },\nCLEAR: { help: 'A FRESH ROLL', run: () => { clear(); text = ''; return 'NEW ROLL' } },\n}\nconst alias: Record<string, string> = { HELP: 'H', '?': 'H' }\nconst helpText = (): string => Object.entries(commands).map(([name, c]) => name.padEnd(7) + c.help).join('\\n')\nconst answer = async (line: string): Promise<string> => {\nif (!line) return ''\nif (chatting) {\nif (/^(bye|exit|quit)$/i.test(line)) {\nchatting = null\nreturn 'LINE CLOSED.'\n}\nchatting.push({ role: 'user', content: line })\nconst said = await ollama.chat(chatting)\nchatting.push({ role: 'assistant', content: said })\nreturn said\n}\nconst [word, ...rest] = line.split(/\\s+/)\nconst command = commands[alias[word.toUpperCase()] ?? word.toUpperCase()]\nif (!command) return '?? ' + word.toUpperCase() + '  WHAT? I KNOW:\\n' + helpText()\nreturn command.run(rest.join(' '))\n}\nlet keys = false\nlet busy = false\nlet buf = ''\nconst enter = async (): Promise<void> => {\nconst line = buf.trim()\nbuf = ''\nput('\\n')\nbusy = true\ntry {\nconst said = await answer(line)\nif (said) put(said.toUpperCase() + '\\n')\n} catch (e) {\nput('?? ' + String((e as Error).message ?? e).toUpperCase() + '\\n')\n}\nbusy = false\nif (text.length > ROLL) {\nclear()\ntext = 'NEW ROLL\\n'\n}\nput(PROMPT)\n}\nlet give = (): void => {}\non(cell, 'click', () => {\nif (!keys) teletype.bell()\nkeys = true\ngive()\ngive = input.claimKeys(() => {\nkeys = false\n})\n})\ninput.onKey(async (key, info) => {\nif (!keys || busy || info.ctrl || info.alt) return\nif (key === 'Escape') {\nkeys = false\ngive()\n} else if (key === 'Enter') await enter()\nelse if (key === 'Backspace') {\nif (buf) put('\\b')\nbuf = buf.slice(0, -1)\n} else {\nconst ch = key === 'Space' ? ' ' : key.length === 1 ? (info.shift ? key.toUpperCase() : key) : ''\nif (!ch) return\nbuf += ch\nput(ch.toUpperCase())\n}\n})\nclear()\nput('LATTAKKER  ASR-33  TERMINAL\\nCLICK THE PAPER, THEN TYPE.  H = HELP.  ESC = KEYBOARD OFF.\\n\\n' + PROMPT)"] } },
  // 14: Lab R50 (the terminal) keeps Enter from opening the editor (input.claimKeys), and Backspace moves the print head back.
  14: { board: {}, lab: { R50: ["span(9, 8)\npaper({ font: 'tty33', speed: 20 })\nconst PROMPT = '>> '\nconst ROLL = 4000\nconst WORDS = ['THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG 0123456789', '10 PRINT \"HELLO, WORLD\"', '20 GOTO 10', 'READY.']\nlet text = ''\nconst put = (more: string): void => {\ntext += more\nshow(text)\n}\ntype Command = { help: string; run: (arg: string) => string | Promise<string> }\nlet chatting: Array<{ role: 'user' | 'assistant'; content: string }> | null = null\nconst hits = async (word: string): Promise<string[]> => {\nconst found: string[] = []\nfor (const t of tabs.list()) {\ntry {\nfor (const c of await mcp.list(t.id)) if ((c.code + ' ' + c.text).toLowerCase().includes(word.toLowerCase())) found.push(c.path)\n} catch {\n}\n}\nreturn found\n}\nconst commands: Record<string, Command> = {\nH: { help: 'THIS LIST', run: () => helpText() },\nSTATUS: {\nhelp: 'TABS, ROUTER, MODEL',\nrun: async () => {\nconst t = tabs.list()\nconst s = mcp.stats()\nconst o = await ollama.status()\nreturn [\n'TABS     ' + t.map((x) => x.id + ':' + x.cells).join(' '),\n'ROUTER   ' + s.messages + ' MSGS, ' + s.errors + ' ERRORS, ' + s.ratePerSecond.toFixed(1) + '/S',\n'SERVERS  ' + s.serverCount + ', LISTENERS ' + s.listeners,\n'MODEL    ' + (o.running ? o.selected : 'NOT RUNNING'),\n'UP       ' + Math.round(s.uptimeSeconds) + ' S',\n].join('\\n')\n},\n},\nMCP: { help: 'SERVERS AND THE BUSIEST', run: () => 'SERVERS ' + mcp.servers().join(' ') + '\\nBUSIEST ' + mcp.stats().servers.slice(0, 3).map((x) => x.name + ' ' + x.requests).join(', ') },\nSYSTEM: { help: 'CPU, MEMORY, TEMPERATURES', run: () => system.text() },\nTIME: { help: 'THE TIME', run: () => new Date().toTimeString().slice(0, 8) + '  ' + new Date().toDateString() },\nFIND: {\nhelp: 'FIND <WORD> IN ALL CELLS',\nrun: async (word) => {\nif (!word) return 'FIND WHAT?'\nconst found = await hits(word)\nif (!found.length) return 'NOTHING FOUND'\nreturn found.slice(0, 8).join('\\n') + (found.length > 8 ? '\\n+' + (found.length - 8) + ' MORE' : '') + '\\nGO <PATH> TAKES YOU THERE'\n},\n},\nGO: {\nhelp: 'GO /LAB/R41  ZOOM TO A CELL',\nrun: async (path) => {\nconst m = /^\\/?([a-z0-9-]+)\\/([a-z]+\\d+)$/i.exec(path.trim())\nif (!m) return 'GO /LAB/R41'\ntabs.select(m[1].toLowerCase())\nawait mcp.tool(m[1].toLowerCase(), 'zoom', { address: m[2].toUpperCase() })\nreturn 'THERE: /' + m[1] + '/' + m[2]\n},\n},\nASK: {\nhelp: 'ASK <QUESTION> OF THE MODEL',\nrun: async (question) => {\nif (!question) return 'ASK WHAT?'\nput('ONE MOMENT...\\n')\nreturn ollama.ask(question + ' (answer in at most three short lines)')\n},\n},\nCHAT: { help: 'TALK WITH THE MODEL, BYE ENDS', run: () => { chatting = []; return 'LINE OPEN. TYPE BYE TO CLOSE IT.' } },\nDEMO: { help: 'WHAT THE MACHINE TYPES', run: () => WORDS.join('\\n') },\nCLEAR: { help: 'A FRESH ROLL', run: () => { clear(); text = ''; return 'NEW ROLL' } },\n}\nconst alias: Record<string, string> = { HELP: 'H', '?': 'H' }\nconst helpText = (): string => Object.entries(commands).map(([name, c]) => name.padEnd(7) + c.help).join('\\n')\nconst answer = async (line: string): Promise<string> => {\nif (!line) return ''\nif (chatting) {\nif (/^(bye|exit|quit)$/i.test(line)) {\nchatting = null\nreturn 'LINE CLOSED.'\n}\nchatting.push({ role: 'user', content: line })\nconst said = await ollama.chat(chatting)\nchatting.push({ role: 'assistant', content: said })\nreturn said\n}\nconst [word, ...rest] = line.split(/\\s+/)\nconst command = commands[alias[word.toUpperCase()] ?? word.toUpperCase()]\nif (!command) return '?? ' + word.toUpperCase() + '  WHAT? I KNOW:\\n' + helpText()\nreturn command.run(rest.join(' '))\n}\nlet keys = false\nlet busy = false\nlet buf = ''\nconst enter = async (): Promise<void> => {\nconst line = buf.trim()\nbuf = ''\nput('\\n')\nbusy = true\ntry {\nconst said = await answer(line)\nif (said) put(said.toUpperCase() + '\\n')\n} catch (e) {\nput('?? ' + String((e as Error).message ?? e).toUpperCase() + '\\n')\n}\nbusy = false\nif (text.length > ROLL) {\nclear()\ntext = 'NEW ROLL\\n'\n}\nput(PROMPT)\n}\non(cell, 'click', () => {\nif (!keys) teletype.bell()\nkeys = true\n})\ninput.onKey(async (key, info) => {\nif (!keys || busy || info.ctrl || info.alt) return\nif (key === 'Escape') keys = false\nelse if (key === 'Enter') await enter()\nelse if (key === 'Backspace') {\nif (buf) put('\\\\')\nbuf = buf.slice(0, -1)\n} else {\nconst ch = key === 'Space' ? ' ' : key.length === 1 ? (info.shift ? key.toUpperCase() : key) : ''\nif (!ch) return\nbuf += ch\nput(ch.toUpperCase())\n}\n})\nclear()\nput('LATTAKKER  ASR-33  TERMINAL\\nCLICK THE PAPER, THEN TYPE.  H = HELP.  ESC = KEYBOARD OFF.\\n\\n' + PROMPT)"] } },
  // 11: board A12 (the random player) used to start playing at once; it now starts on hold and a click starts or holds it.
  11: { board: { A12: ["span(4, 3)\ntype Side = 'red' | 'blue'\ninterface Step {\nfrom: string\nto: string\n}\nconst PLAYS: Side[] = ['red']\nconst PAUSE: string = '700ms'\nif (PLAYS.includes('blue')) game.takeOverBlue()\nlet made: number = 0\nconst pick = (steps: Step[]): Step => steps[Math.floor(Math.random() * steps.length)]\nconst tick = (): void => {\nif (game.phase === 'over') {\nshow(`Game over: ${game.winner ?? 'nobody'} won after ${made} moves of mine`)\nstop()\nreturn\n}\nif (game.phase !== 'play') {\nshow('Waiting: press Start on the game')\nreturn\n}\nif (game.busy) return\nconst side: Side = game.turn\nif (!PLAYS.includes(side)) return\nconst steps: Step[] = game.legalMoves(side)\nif (steps.length === 0) {\nshow(`${side} cannot move`)\nreturn\n}\nconst step: Step = pick(steps)\nconst answer: string = game.move(step.from, step.to, side)\nif (answer.startsWith('Moving')) made++\nshow(`${side}: ${step.from} → ${step.to}\\n${made} moves made\\nA random player: no thinking`)\n}\nevery(PAUSE, tick)\nshow('Random player ready')\ncolor('#e1e6f0')"] }, lab: {} },
  // 10: board A12 was the red/blue piece counter; it is now a typed random player (and can play Blue too).
  10: { board: { A12: ["span(4, 2)\nconst red = game.pieces('red').length\nconst blue = game.pieces('blue').length\nprint(`Red has ${red} pieces`)\nprint(`Blue has ${blue} pieces`)\ncolor(red >= blue ? '#d9e8dd' : '#f0d8d5')"] }, lab: {} },
  // 8: Lab A31 calls draw() without the arguments it asks for; the cells are now checked as strictly as the app (draw(last?, from?)).
  8: { board: {}, lab: { A31: ["span(5, 3)\nmemory.heard = memory.heard ?? 0\nconst draw = (last, from) => show(\n'I listen for waves from any tab\\n' +\n'Waves heard: ' + memory.heard + '\\n' +\n(from ? 'Latest: wave ' + last + ' from ' + from : 'Nothing yet. Click Q42 on the board.')\n)\nmcp.on('wave', (n, from) => {\nmemory.heard++\ncolor('hsl(' + ((n * 47) % 360) + ', 60%, 82%)')\ndraw(n, from)\nmcp.emit('echo', n)\n})\ndraw()"] } },
  2: {
    board: {
      A15: [
        "span(4, 2)\nconst first = at('A12').text.split('\\n')[0]\nprint('A12 says: ' + first)\nprint('2 + 3 * 4 = ' + (2 + 3 * 4))\nat('L12').print('Hello from A15 ').color('#f2e4bd')",
      ],
    },
    lab: {},
  },
};

const codeOnly = (code: string): string =>
  code
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
    .join('\n');

export interface MigrationInput {
  /** True when the board's sheet was filled from this browser's saved cells (false: a first visit, which got every example). */
  restored: boolean;
  board: Sheet;
  lab: Sheet;
  examples: ReadonlyArray<[string, string]>;
  labDemos: ReadonlyArray<[string, string]>;
}

/** Returns how many cells were added or updated. */
export function migrateExamples({ restored, board, lab, examples, labDemos }: MigrationInput): number {
  let seen = EXAMPLES_REV;
  try {
    seen = restored ? Number(localStorage.getItem(KEY) ?? 1) || 1 : EXAMPLES_REV;
  } catch {
    return 0;
  }
  let changed = 0;
  for (let rev = seen + 1; rev <= EXAMPLES_REV; rev++) {
    const apply = (sheet: Sheet, list: ReadonlyArray<[string, string]>, added: string[] = [], replaced: Record<string, string[]> = {}): void => {
      for (const [address, code] of list) {
        // A demo below the last row of a saved sheet gets the rows it needs.
        const row = Number(/\d+/.exec(address)?.[0] ?? 1);
        while (added.includes(address) && sheet.rowCount < row + 8 && sheet.rowCount < 200) sheet.insertRow(sheet.rowCount - 1);
        const d = sheet.dataAt(address);
        if (!d) continue;
        const old = replaced[address];
        if (old && d.code.trim() && old.includes(codeOnly(d.code))) {
          sheet.setCode(address, code);
          changed++;
        } else if (added.includes(address) && !d.code.trim()) {
          sheet.setCode(address, code);
          changed++;
        }
      }
    };
    apply(board, examples, ADDED[rev]?.board, REPLACED[rev]?.board);
    apply(lab, labDemos, ADDED[rev]?.lab, REPLACED[rev]?.lab);
    for (const [address, known] of Object.entries(REMOVED[rev]?.lab ?? {})) {
      const olds = typeof known === 'function' ? known() : known;
      const d = lab.dataAt(address);
      if (d && d.code.trim() && olds.includes(codeOnly(d.code))) {
        lab.setCode(address, '');
        changed++;
      }
    }
  }
  try {
    localStorage.setItem(KEY, String(EXAMPLES_REV));
  } catch {
    // not remembered: it simply runs again next time, and it only ever fills empty or untouched cells
  }
  return changed;
}
