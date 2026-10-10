// Writes original piece icons (number, tiny name, 10-step strength meter) to resources/pieces/.
import { mkdirSync, writeFileSync } from 'node:fs';

const NAMES = { 10: 'Marshal', 9: 'General', 8: 'Colonel', 7: 'Major', 6: 'Captain', 5: 'Lieutenant', 4: 'Sergeant', 3: 'Miner', 2: 'Scout', 1: 'Spy', B: 'Bomb', F: 'Flag' };
const SIDES = { red: { fill: '#a8433e', stroke: '#7a2e2a' }, blue: { fill: '#2f5d8c', stroke: '#1f4166' } };
const INK = '#f6f3ea';
const S = 100;

function glyph(rank) {
  if (rank === 'B') {
    return `<circle cx="50" cy="42" r="20" fill="#16202a" stroke="${INK}" stroke-width="2"/><path d="M60 30 C65 20 72 22 74 13" fill="none" stroke="${INK}" stroke-width="3"/><circle cx="75" cy="12" r="5" fill="${INK}"/><circle cx="41" cy="35" r="5" fill="#fff" fill-opacity=".35"/>`;
  }
  if (rank === 'F') {
    return `<path d="M34 68V14" stroke="${INK}" stroke-width="3"/><path d="M34 14L74 28L34 44Z" fill="${INK}" stroke="${INK}" stroke-width="1.5"/>`;
  }
  const bars = [];
  for (let i = 0; i < 10; i++) {
    bars.push(`<rect x="${14 + i * 7.5}" y="80" width="6.2" height="7" fill="${INK}" fill-opacity="${i < rank ? 0.95 : 0.22}"/>`);
  }
  return `<text x="50" y="42" font-family="system-ui,sans-serif" font-size="40" font-weight="700" text-anchor="middle" fill="${INK}">${rank}</text>${bars.join('')}`;
}

mkdirSync('resources/pieces', { recursive: true });
for (const [side, c] of Object.entries(SIDES)) {
  for (const [rank, name] of Object.entries(NAMES)) {
    const nameY = rank === 'B' || rank === 'F' ? 80 : 64;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}"><title>${side} ${name}</title><rect x=".5" y=".5" width="99" height="99" rx="14" fill="${c.fill}" stroke="${c.stroke}"/><rect x="7" y="7" width="86" height="86" rx="9" fill="none" stroke="#fff" stroke-opacity=".3"/>${glyph(rank === 'B' || rank === 'F' ? rank : Number(rank))}<text x="50" y="${nameY}" font-family="system-ui,sans-serif" font-size="11" font-weight="700" text-anchor="middle" fill="${INK}">${name}</text></svg>\n`;
    writeFileSync(`resources/pieces/${side}-${name.toLowerCase()}.svg`, svg);
  }
}
console.log('wrote 24 icons');
