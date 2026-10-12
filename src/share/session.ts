import { parseAddress } from '../sheet/address';
import type { Sheet } from '../sheet/Sheet';
import type { Transport } from './link';
import type { Workspace } from '../workspace';

/**
 * A shared session between two people, over a Transport (see link.ts). The host (the one who started
 * sharing, usually the learner) sends a copy of every code cell when the guest arrives. After that both
 * sides show where the other one is pointing, can follow each other between tabs and chat, and, only if
 * the host switched "let the other person change my code" on, edits to a cell travel in both directions.
 *
 * Each side runs the cells itself; only code, sizes and pointers travel. Moving cells, the game and
 * what cells print are not shared.
 *
 * Everything the other side sends is checked before it is used: the peer is trusted to the extent that
 * the host allows edits, but never to the extent of crashing the page with a malformed message.
 */

export type Role = 'host' | 'guest';

export interface SessionHooks {
  /** A line for the people to read (a chat message, a notice). */
  toast(text: string): void;
  /** The guest's page shows someone else's cells: do not save them over the guest's own work. */
  pauseSaving(paused: boolean): void;
}

export interface SessionInfo {
  role: Role;
  /** The other person's name once they said hello. */
  peerName: string;
  /** Edits travel in both directions. Only the host decides. */
  canEdit: boolean;
  /** Guest only: switch to the tab the host switches to. */
  follow: boolean;
  open: boolean;
}

const MAX_CODE = 20000;
const MAX_CELLS = 400;
const MAX_NAME = 24;
const MAX_CHAT = 300;
const ADDRESS = /^[A-Z]{1,3}\d{1,3}$/;
const UID = /^c-[0-9a-f]{8}$/;
const SEND_DELAY_MS = 150;
const PRESENCE_COLOR = '#d9c8f0';
const MAX_ROWS = 500;

type Cell = { tab: string; address: string; uid: string; code: string; span: { cols: number; rows: number } | null };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const cleanName = (v: unknown): string => (typeof v === 'string' ? v.replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, MAX_NAME) : '') || 'Friend';

export class ShareSession {
  readonly info: SessionInfo;
  private dead = false;
  private applying = false;
  private incomingCells = 0;
  private readonly pending = new Map<string, number>();
  private readonly changeListeners: Array<() => void> = [];
  private seenThisSecond = 0;
  private secondStart = 0;

  constructor(
    private readonly ws: Workspace,
    private readonly link: Transport,
    role: Role,
    myName: string,
    private readonly hooks: SessionHooks,
    allowEdits = false,
  ) {
    this.info = { role, peerName: '', canEdit: role === 'host' ? allowEdits : false, follow: true, open: link.open };
    link.onMessage((m) => this.receive(m));
    link.onOpen(() => {
      this.info.open = true;
      this.send({ t: 'hello', name: cleanName(myName), role, v: 1 });
      this.changed();
    });
    link.onClose(() => this.end('The other person left, or the connection broke.'));
    if (link.open) this.send({ t: 'hello', name: cleanName(myName), role, v: 1 });

    for (const tab of ws.list()) {
      tab.sheet.onCodeChanged((address) => this.queue(tab.id, address));
    }
    ws.onFocusChange((f) => {
      if (f && !this.dead) this.send({ t: 'focus', tab: f.tab, address: f.address, tile: f.tile });
    });
    ws.onCurrentChange((id) => {
      if (!this.dead) this.send({ t: 'tab', id });
    });
  }

  onChange(listener: () => void): void {
    this.changeListeners.push(listener);
  }

  private changed(): void {
    this.changeListeners.forEach((l) => l());
  }

  // ------------------------------------------------------------------ what the people can do

  /** Host: let the other person change my code (or not). Takes effect at once on both sides. */
  setAllowEdits(on: boolean): void {
    if (this.info.role !== 'host') return;
    this.info.canEdit = on;
    this.send({ t: 'perm', edit: on });
    this.changed();
  }

  setFollow(on: boolean): void {
    this.info.follow = on;
    this.changed();
  }

  chat(text: string): void {
    const clean = text.trim().slice(0, MAX_CHAT);
    if (clean) this.send({ t: 'chat', text: clean });
  }

  stop(): void {
    if (this.dead) return;
    this.send({ t: 'bye' });
    this.end('Sharing stopped.');
    this.link.close();
  }

  private end(why: string): void {
    if (this.dead) return;
    this.dead = true;
    this.info.open = false;
    for (const timer of this.pending.values()) window.clearTimeout(timer);
    this.pending.clear();
    this.ws.setRemote(null);
    if (this.info.role === 'host') this.hooks.pauseSaving(false);
    this.hooks.toast(why);
    this.changed();
  }

  // ------------------------------------------------------------------ sending

  private send(message: Record<string, unknown>): void {
    if (!this.dead || message.t === 'bye') this.link.send(message);
  }

  private cellMessage(tabId: string, address: string): Record<string, unknown> | null {
    const sheet = this.ws.get(tabId)?.sheet;
    const d = sheet?.dataAt(address);
    if (!d) return null;
    return { t: 'cell', tab: tabId, address, uid: d.uid, code: d.code, span: { cols: d.span.cols, rows: d.span.rows } };
  }

  /** A cell changed here: tell the other side a moment later (typing sends one message, not one per key). */
  private queue(tabId: string, address: string): void {
    if (this.dead || this.applying || !this.info.open) return;
    if (this.info.role === 'guest' && !this.info.canEdit) return;
    const key = `${tabId}/${address}`;
    window.clearTimeout(this.pending.get(key));
    this.pending.set(
      key,
      window.setTimeout(() => {
        this.pending.delete(key);
        const m = this.cellMessage(tabId, address);
        if (m) this.send(m);
      }, SEND_DELAY_MS),
    );
  }

  private sendSnapshot(): void {
    const sizes: Record<string, { rows: number; cols: number; mode: string }> = {};
    for (const tab of this.ws.list()) sizes[tab.id] = { rows: tab.sheet.rowCount, cols: tab.sheet.colCount, mode: tab.sheet.mode };
    this.send({ t: 'snap', sizes });
    let n = 0;
    for (const tab of this.ws.list()) {
      for (const d of tab.sheet.codeCells()) {
        if (n++ >= MAX_CELLS) break;
        const m = this.cellMessage(tab.id, d.address);
        if (m) this.send(m);
      }
    }
    this.send({ t: 'snapEnd' });
  }

  // ------------------------------------------------------------------ receiving

  private receive(raw: unknown): void {
    if (this.dead || !isRecord(raw) || typeof raw.t !== 'string') return;
    const now = performance.now();
    if (now - this.secondStart > 1000) {
      this.secondStart = now;
      this.seenThisSecond = 0;
    }
    // A snapshot is hundreds of messages at once; anything beyond that in one second is noise.
    if (++this.seenThisSecond > 1500) return;
    switch (raw.t) {
      case 'hello':
        this.info.peerName = cleanName(raw.name);
        this.hooks.toast(`${this.info.peerName} is connected 🤝`);
        if (this.info.role === 'host') {
          this.send({ t: 'perm', edit: this.info.canEdit });
          this.sendSnapshot();
        }
        this.changed();
        break;
      case 'perm':
        if (this.info.role === 'guest' && typeof raw.edit === 'boolean') {
          this.info.canEdit = raw.edit;
          this.hooks.toast(raw.edit ? `${this.info.peerName || 'The host'} lets you change the code ✏️` : `${this.info.peerName || 'The host'} made it view-only 👁`);
          this.changed();
        }
        break;
      case 'snap':
        if (this.info.role === 'guest') this.beginSnapshot(raw.sizes);
        break;
      case 'snapEnd':
        this.applying = false;
        this.hooks.toast(`You are looking at ${this.info.peerName || 'the host'}'s cells (your own are safe and come back when you leave).`);
        break;
      case 'cell':
        this.receiveCell(raw);
        break;
      case 'focus':
        this.receiveFocus(raw);
        break;
      case 'tab':
        if (this.info.role === 'guest' && this.info.follow && typeof raw.id === 'string') this.ws.get(raw.id)?.select();
        break;
      case 'chat':
        if (typeof raw.text === 'string') this.hooks.toast(`${this.info.peerName || 'Friend'}: ${raw.text.slice(0, MAX_CHAT)}`);
        break;
      case 'bye':
        this.end(`${this.info.peerName || 'The other person'} stopped sharing.`);
        this.link.close();
        break;
    }
  }

  /** The guest's sheets become copies of the host's: clear what is there (kept safe in storage, saving is paused), then the cells follow. */
  private beginSnapshot(sizes: unknown): void {
    this.hooks.pauseSaving(true);
    this.applying = true;
    this.incomingCells = 0;
    for (const tab of this.ws.list()) {
      for (const d of tab.sheet.codeCells()) tab.sheet.setCode(d.address, '');
      const size = isRecord(sizes) && isRecord(sizes[tab.id]) ? (sizes[tab.id] as Record<string, unknown>) : null;
      if (size && Number.isInteger(size.rows) && Number.isInteger(size.cols)) this.growTo(tab.sheet, Math.min(MAX_ROWS, Number(size.rows)) - 1, Number(size.cols) - 1);
      if (size && (size.mode === 'run' || size.mode === 'view')) tab.sheet.setMode(size.mode);
    }
  }

  private growTo(sheet: Sheet, row: number, col: number): void {
    while (sheet.rowCount <= row && sheet.rowCount < MAX_ROWS) sheet.insertRow(sheet.rowCount - 1);
    if (col >= sheet.colCount && col < 52) sheet.addColumns(col + 1 - sheet.colCount);
  }

  private parseCell(raw: Record<string, unknown>): Cell | null {
    if (typeof raw.tab !== 'string' || typeof raw.address !== 'string' || typeof raw.code !== 'string') return null;
    if (!ADDRESS.test(raw.address) || raw.code.length > MAX_CODE) return null;
    if (!this.ws.get(raw.tab)) return null;
    const uid = typeof raw.uid === 'string' && UID.test(raw.uid) ? raw.uid : '';
    let span: Cell['span'] = null;
    if (isRecord(raw.span) && Number.isInteger(raw.span.cols) && Number.isInteger(raw.span.rows)) {
      const cols = Number(raw.span.cols);
      const rows = Number(raw.span.rows);
      if (cols >= 1 && rows >= 1 && cols <= 60 && rows <= 60) span = { cols, rows };
    }
    return { tab: raw.tab, address: raw.address, uid, code: raw.code, span };
  }

  private receiveCell(raw: Record<string, unknown>): void {
    const live = !this.applying;
    // Live edits from the guest only count when the host allowed them; the host's edits always do.
    if (live && this.info.role === 'host' && !this.info.canEdit) return;
    if (!live && ++this.incomingCells > MAX_CELLS) return;
    const c = this.parseCell(raw);
    if (!c) return;
    const sheet = this.ws.get(c.tab)!.sheet;
    const pos = parseAddress(c.address);
    if (!pos) return;
    const was = this.applying;
    this.applying = true;
    try {
      this.growTo(sheet, pos.row, pos.col);
      const address = sheet.resolve(c.address);
      if (!address) return;
      if (sheet.dataAt(address)!.code !== c.code) sheet.setCode(address, c.code, c.uid || undefined);
      if (c.span && c.code.trim()) sheet.setSpan(address, c.span.cols, c.span.rows);
    } finally {
      this.applying = was;
    }
  }

  private receiveFocus(raw: Record<string, unknown>): void {
    if (typeof raw.tab !== 'string' || typeof raw.address !== 'string' || !ADDRESS.test(raw.address)) return;
    const tab = this.ws.get(raw.tab);
    if (!tab) return;
    let tile: { x: number; y: number } | null = null;
    if (isRecord(raw.tile) && Number.isInteger(raw.tile.x) && Number.isInteger(raw.tile.y)) tile = { x: Number(raw.tile.x), y: Number(raw.tile.y) };
    const address = tab.sheet.resolve(raw.address);
    if (!address) return;
    this.ws.setRemote({ name: this.info.peerName || 'Friend', tab: raw.tab, address, tile });
    tab.sheet.flash(address, PRESENCE_COLOR, 900);
  }
}
