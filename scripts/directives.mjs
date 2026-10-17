// Manages the standing directives for every AI in Lattakker (ai-docs/directives.json). Nothing here needs a build.
//
//   node scripts/directives.mjs list
//   node scripts/directives.mjs add --strength 70 --end 2030-12-31 "The rule text"      (--end none = no end of life)
//   node scripts/directives.mjs update 3 [--strength 50] [--end 2031-01-01|none] [--text "New text"]
//   node scripts/directives.mjs retire 3                                                  (ends it yesterday: it stays in the file)
//
// Strength 0 to 100 (%): 100 = "you should always" (careful!), 70 = strong preference, 50 = indifferent, 0 = present but not relevant.
// A strength of 100 is only taken with --yes, because it is the one that can steer every AI too hard.
// Every change stamps "updated" and keeps the earlier version in the directive's own history (git keeps the rest).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = process.env.DIRECTIVES_FILE ?? fileURLToPath(new URL('../ai-docs/directives.json', import.meta.url));
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const args = process.argv.slice(2);
const command = args.shift();
const flags = {};
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--yes') flags.yes = true;
  else if (args[i].startsWith('--')) flags[args[i].slice(2)] = args[++i];
  else rest.push(args[i]);
}

const die = (message) => {
  console.error(message);
  process.exit(1);
};
const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const day = (offset = 0) => {
  const d = new Date(Date.now() + offset * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const load = () => JSON.parse(readFileSync(FILE, 'utf8'));
const save = (data) => writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`);

function strength(value) {
  const n = Number(String(value).replace('%', ''));
  if (!Number.isFinite(n) || n < 0 || n > 100) die('--strength must be a number from 0 to 100 (percent).');
  if (Math.round(n) === 100 && !flags.yes) die('Strength 100 ("you should ALWAYS") steers every AI hard. Add --yes if you really mean it.');
  return Math.round(n);
}
function end(value) {
  if (value === 'none') return null;
  if (!DAY.test(String(value)) || Number.isNaN(Date.parse(value))) die('--end must be a day like 2030-12-31, or "none".');
  return value;
}

const data = load();

if (command === 'list') {
  const t = day();
  for (const d of data.directives) {
    const dead = d.endOfLife && t > d.endOfLife ? ' [ENDED]' : '';
    console.log(`#${d.number}  ${d.strength}%  until ${d.endOfLife ?? '-'}${dead}  (made ${d.created}, changed ${d.updated}, ${d.history.length} earlier version${d.history.length === 1 ? '' : 's'})\n    ${d.text}`);
  }
  if (!data.directives.length) console.log('No directives yet.');
} else if (command === 'add') {
  const text = rest.join(' ').trim();
  if (!text) die('Give the rule text.');
  if (flags.strength === undefined) die('Give --strength (0 to 100).');
  const now = stamp();
  const directive = { number: data.next, created: now, updated: now, strength: strength(flags.strength), endOfLife: end(flags.end ?? 'none'), text, history: [] };
  data.directives.push(directive);
  data.next += 1;
  save(data);
  console.log(`Added #${directive.number}: ${directive.strength}%, ends ${directive.endOfLife ?? 'never'}.`);
} else if (command === 'update' || command === 'retire') {
  const d = data.directives.find((x) => x.number === Number(rest[0]));
  if (!d) die(`There is no directive number ${rest[0]}.`);
  d.history.push({ updated: d.updated, strength: d.strength, endOfLife: d.endOfLife, text: d.text });
  if (command === 'retire') d.endOfLife = day(-1);
  else {
    if (flags.strength !== undefined) d.strength = strength(flags.strength);
    if (flags.end !== undefined) d.endOfLife = end(flags.end);
    if (flags.text !== undefined) d.text = String(flags.text).trim();
  }
  d.updated = stamp();
  save(data);
  console.log(`Changed #${d.number}: ${d.strength}%, ends ${d.endOfLife ?? 'never'}.`);
} else {
  die('Use: list | add --strength N [--end YYYY-MM-DD] "text" | update N [--strength N] [--end D|none] [--text "..."] | retire N');
}
