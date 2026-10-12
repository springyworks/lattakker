import { InternalEvent, type Cell, type MaxPopupMenu, type PopupMenuHandler } from '@maxgraph/core';
import type { Sheet } from '../sheet/Sheet';
import type { GameView } from '../game/GameView';
import { colToLetters, formatAddress, parseAddress } from '../sheet/address';
import { GAME_NODE, clickNode, codeNode, describeNode, sizeNode } from '../sheet/reactivity';
import { buildApi } from '../sheet/api';
import { runCell } from '../sheet/runtime';
import { CellEditor } from '../editor/CellEditor';
import { CellCodeView } from '../editor/CellCodeView';
import { ContextPopups } from '../editor/ContextPopups';
import { transpile } from '../editor/monaco';
import { THEME } from '../theme';
import { CellMenu } from './CellMenu';
import type { MenuItem } from './HoverMenu';
import { Navigator } from './Navigator';
import { workspace } from '../workspace';

export type Tone = 'info' | 'good' | 'bad';
export type Say = (text: string, tone?: Tone) => void;

export interface PaneHooks {
  /** Where messages go: the speech bubble on the board's sheet, a status line on the lab's. */
  say: Say;
  /** Rows above this index cannot get a new row below them (the board's own rows). */
  firstFreeRow?: number;
  /** The code editor opened or closed. */
  onEditorOpen?(address: string): void;
  onEditorClose?(): void;
  /** A click on a square of the game board (only the board's sheet has any). */
  onBoardClick?(address: string): void;
  /** Return false to ignore a double-click (during the battle it is part of moving a piece). */
  mayEdit?(address: string): boolean;
  /** Clicks on anything that is not a plain sheet cell: pieces, buttons, the cockpit. Return true when handled. */
  onOtherClick?(id: string, cell: Cell, evt: MouseEvent): boolean;
  tooltipFor?(id: string): string | null;
  /** Click on the corner cell. */
  onCorner(): void;
  /** Whether the sheet shows the board's divider in the navigator. */
  hasBoard: boolean;
}

/**
 * Everything one sheet needs to be a working sheet: the code runner, the popup and inline editors,
 * clicks, the hover and right-click menus, reference following and the "Go to" navigator. The game
 * board's sheet and the lab's sheet are both wired by this, so they behave exactly the same.
 */
export class SheetPane {
  readonly editor: CellEditor;
  readonly popups: ContextPopups;
  readonly cellMenu: CellMenu;
  readonly navigator: Navigator;
  selectedCodeCell: string | null = null;
  lastSheetCell: string;
  private deleteArmed: string | null = null;
  private deleteTimer = 0;

  constructor(
    readonly sheet: Sheet,
    view: GameView,
    private readonly hooks: PaneHooks,
    firstCell: string,
  ) {
    this.lastSheetCell = firstCell;
    // Must exist before any Monaco editor of this sheet is created: it listens for every new editor.
    this.popups = new ContextPopups(sheet);
    this.editor = new CellEditor(sheet, {
      onSave: (address, code) => {
        sheet.setCode(address, code);
        hooks.say(`Restarted ${address} ✓ ${code.trim() ? 'It runs from the top now, and again after every move.' : 'The cell is empty again.'}`, 'good');
      },
      onRun: (address, code) => {
        sheet.setCode(address, code);
        hooks.say(`Restarted ${address} ▶ Its timers stopped and the code runs from the top.`, 'info');
      },
      onOpen: (address) => hooks.onEditorOpen?.(address),
      onClose: () => hooks.onEditorClose?.(),
      onOutputClick: (address) => {
        sheet.pulse(clickNode(address));
        sheet.flash(address, THEME.flash, 300);
      },
    });
    new CellCodeView(sheet);
    this.cellMenu = new CellMenu(sheet, { itemsFor: (address) => this.menuItemsFor(address) });

    sheet.setRunner((data, ctx) => runCell(data, ctx, (d, c) => buildApi(sheet, view, hooks, d, c), (a, s) => transpile(a, s, sheet.id)));
    sheet.raiseHeaders();
    this.installListeners();
    this.installSheetHandlers();
    this.installContextMenu();
    this.navigator = new Navigator(sheet, {
      hasBoard: hooks.hasBoard,
      onJump: ({ address, row }) => {
        sheet.reveal(row, address ? parseAddress(address)?.col : undefined);
        if (!address) {
          sheet.highlightRow(row, 800, [247, 214, 130]);
          hooks.say(`Row ${row + 1}.`, 'info');
        } else if (sheet.isBoardAddress(address)) {
          sheet.flash(address, THEME.flash, 800);
        } else {
          this.selectCodeCell(address);
        }
      },
      onBadInput: (text) => hooks.say(`"${text}" is not a cell or a row. Try Q120 or 120.`, 'bad'),
    });
  }

  selectCodeCell(address: string): void {
    const sheet = this.sheet;
    if (this.selectedCodeCell) sheet.setSelectionVisual(this.selectedCodeCell, null);
    this.selectedCodeCell = address;
    this.lastSheetCell = address;
    sheet.setSelectionVisual(address, { stroke: THEME.select, strokeWidth: 3 });
    sheet.flash(address, THEME.flash);
    const d = sheet.dataAt(address)!;
    this.hooks.say(
      d.code
        ? `Cell ${address} has code in it. Double-click it (or press "Code cell") to edit. ${sheet.mode === 'view' ? 'You are looking at its code.' : 'You are looking at its output.'}`
        : `Cell ${address} is empty. Double-click it (or press "Code cell") to write TypeScript there ✏️`,
      'info',
    );
  }

  // ------------------------------------------------------------------ clicks

  private installListeners(): void {
    const { sheet, hooks } = this;
    sheet.setListeners({
      onCellClick: (address) => {
        workspace.setFocus(sheet.id, address, sheet.takeTileClick(address));
        sheet.pulse(clickNode(address));
        if (sheet.isBoardAddress(address)) {
          this.lastSheetCell = address;
          hooks.onBoardClick?.(address);
        } else {
          this.selectCodeCell(address);
        }
      },
      onCellDoubleClick: (address) => {
        if (hooks.mayEdit && !hooks.mayEdit(address)) return;
        this.editor.open(address);
      },
      onOtherClick: (id, cell, evt) => {
        if (id.startsWith('ctx:')) {
          this.popups.handleClick(id);
        } else if (id.startsWith('ed:btn')) {
          this.editor.handleButton(id);
        } else if (hooks.onOtherClick?.(id, cell, evt)) {
          return;
        } else if (id === 'hdr:corner') {
          hooks.onCorner();
        } else if (id.startsWith('hdr:c')) {
          const col = Number(id.slice(5));
          for (let r = 0; r < sheet.rowCount; r++) sheet.flash(formatAddress(col, r), THEME.flash, 400);
          hooks.say(`Column ${colToLetters(col)} — cells ${colToLetters(col)}1 to ${colToLetters(col)}${sheet.rowCount}.`, 'info');
        } else if (id.startsWith('hdr:r')) {
          const row = Number(id.slice(5));
          for (let c = 0; c < sheet.colCount; c++) sheet.flash(formatAddress(c, row), THEME.flash, 400);
          hooks.say(`Row ${row + 1} — cells A${row + 1} to ${colToLetters(sheet.colCount - 1)}${row + 1}.`, 'info');
        }
      },
      tooltipFor: (id) => {
        if (id === 'hdr:corner') return hooks.tooltipFor?.(id) ?? 'Click here to jump back to the top-left';
        if (id.startsWith('ctx:row:')) return 'Rest here ½ second to peek · click to jump there';
        if (id.startsWith('ctx:livebar:')) return 'A live copy — edits here are real. Click to go to the cell.';
        return hooks.tooltipFor?.(id) ?? null;
      },
    });
  }

  private installSheetHandlers(): void {
    const { sheet, hooks } = this;
    sheet.onRowsInserted((afterRowIndex) => {
      const remap = (addr: string): string => {
        const p = parseAddress(addr);
        if (!p || p.row <= afterRowIndex) return addr;
        return formatAddress(p.col, p.row + 1);
      };
      if (this.selectedCodeCell) {
        const next = remap(this.selectedCodeCell);
        if (next !== this.selectedCodeCell) {
          sheet.setSelectionVisual(this.selectedCodeCell, null);
          this.selectedCodeCell = next;
          sheet.setSelectionVisual(next, { stroke: THEME.select, strokeWidth: 3 });
        }
      }
      this.lastSheetCell = remap(this.lastSheetCell);
      if (this.editor.isOpen && this.editor.address) {
        const p = parseAddress(this.editor.address);
        if (p && p.row > afterRowIndex) this.editor.close(false);
      }
    });

    sheet.onContentMoved((from, to) => {
      if (this.selectedCodeCell === from) {
        sheet.setSelectionVisual(from, null);
        this.selectedCodeCell = to;
        sheet.setSelectionVisual(to, { stroke: THEME.select, strokeWidth: 3 });
      }
      if (this.lastSheetCell === from) this.lastSheetCell = to;
      if (this.editor.isOpen && (this.editor.address === from || this.editor.address === to)) this.editor.close(false);
      hooks.say(`Moved ${from}'s content to ${to} 📦`, 'good');
    });

    sheet.onRoomMade(({ displaced, addedCols, addedRows, shifts }) => {
      const parts: string[] = [];
      if (displaced > 0) {
        const where = shifts.slice(0, 3).map((s) => `${s.from}→${s.to}`).join(', ');
        parts.push(`${displaced} ${displaced === 1 ? 'cell' : 'cells'} stepped aside (${where}${shifts.length > 3 ? '…' : ''})`);
      }
      if (addedCols > 0) parts.push(`${addedCols} new ${addedCols === 1 ? 'column' : 'columns'}`);
      if (addedRows > 0) parts.push(`${addedRows} new ${addedRows === 1 ? 'row' : 'rows'}`);
      if (parts.length > 0) hooks.say(`Made room: ${parts.join(', ')}.`, 'good');
    });

    sheet.onReferencesUpdated(({ count, cells, warnings }) => {
      if (this.editor.isOpen) this.editor.refreshFromSheet();
      if (cells.length > 0 && cells.length <= 12) for (const address of cells) sheet.flash(address, THEME.flash, 700);
      const parts: string[] = [];
      if (count > 0) {
        parts.push(`Updated ${count} ${count === 1 ? 'reference' : 'references'} in ${cells.length <= 4 ? cells.join(', ') : `${cells.length} cells`} so the code still points at the same cells.`);
      }
      parts.push(...warnings.slice(0, 3));
      if (warnings.length > 3) parts.push(`(and ${warnings.length - 3} more like that)`);
      hooks.say(parts.join(' '), warnings.length > 0 ? 'bad' : 'good');
    });
  }

  // ------------------------------------------------------------ right-click menu

  private installContextMenu(): void {
    const { sheet, hooks } = this;
    InternalEvent.disableContextMenu(sheet.container);
    const popupMenu = sheet.graph.getPlugin<PopupMenuHandler>('PopupMenuHandler')!;
    popupMenu.selectOnPopup = false;
    popupMenu.factoryMethod = (menu, cell) => {
      const id = cell?.getId() ?? '';
      if (id.startsWith('hdr:r')) {
        const rowIndex = Number(id.slice(5));
        if (rowIndex < (hooks.firstFreeRow ?? 0)) return;
        menu.addItem(`Insert row below ${rowIndex + 1}`, null, () => {
          sheet.insertRow(rowIndex);
          sheet.reveal(rowIndex + 1);
          sheet.highlightRow(rowIndex + 1);
          hooks.say(`Inserted a new row ${rowIndex + 2}. Everything below moved down one; references in code are updated.`, 'good');
        });
      } else if (id.startsWith('sheet:')) {
        const address = id.slice(6);
        const isBoard = sheet.isBoardAddress(address);
        if (!isBoard) {
          menu.addItem(`Edit ${address}`, null, () => this.editor.open(address));
          if (sheet.dataAt(address)?.code) menu.addItem(`Clear ${address}`, null, () => sheet.setCode(address, ''));
          const tasks = sheet.taskCount(address);
          if (tasks > 0) {
            menu.addItem(`Stop timers in ${address} (${tasks})`, null, () => {
              sheet.stopTasks(address);
              sheet.notifyChanged(address);
              hooks.say(`Stopped the timers and watchers in ${address}.`, 'good');
            });
          }
          const d = sheet.dataAt(address);
          if (d?.code) {
            const { cols, rows } = d.span;
            const sub = menu.addItem(`Size ${cols}×${rows}`, null, () => {});
            const resize = (c: number, r: number): void => this.resize(address, c, r);
            menu.addItem('Wider', null, () => resize(cols + 1, rows), sub);
            menu.addItem('Narrower', null, () => resize(cols - 1, rows), sub, undefined, cols > 1);
            menu.addItem('Taller', null, () => resize(cols, rows + 1), sub);
            menu.addItem('Shorter', null, () => resize(cols, rows - 1), sub, undefined, rows > 1);
            menu.addItem('Back to 1×1', null, () => resize(1, 1), sub, undefined, cols > 1 || rows > 1);
          }
          menu.addSeparator();
        }
        this.addCellList(menu, 'Used by', sheet.dependentsOf(address), 'No cell reads this one');
        if (!isBoard) this.addCellList(menu, 'Reads', sheet.readsOf(address), 'Reads nothing');
      }
    };
  }

  private resize(address: string, cols: number, rows: number): void {
    this.sheet.setSpan(address, cols, rows);
    const now = this.sheet.dataAt(address)!.span;
    this.hooks.say(`${address} is now ${now.cols}×${now.rows}. Code that reads cell.cols or watches 'size' wakes up.`, 'good');
  }

  private jumpTo(target: string): void {
    this.sheet.flash(target, THEME.flash, 600);
    if (!this.sheet.isBoardAddress(target)) this.selectCodeCell(target);
  }

  /** Adds a sub-menu listing cells; picking one selects and flashes it. */
  private addCellList(menu: MaxPopupMenu, title: string, items: string[], emptyText: string): void {
    const sheet = this.sheet;
    const board = items.filter((a) => sheet.isBoardAddress(a));
    const others = items.filter((a) => !sheet.isBoardAddress(a) && a !== GAME_NODE);
    const parts = others.map(describeNode);
    if (items.includes(GAME_NODE)) parts.push('game');
    if (board.length > 0) parts.push(board.length === 1 ? board[0] : `${board.length} board squares`);
    if (parts.length === 0) {
      menu.addItem(`${title}: ${emptyText}`, null, () => {}, null, undefined, false);
      return;
    }
    const sub = menu.addItem(`${title} (${parts.length})`, null, () => {});
    for (const part of parts.slice(0, 14)) {
      const first = part.split(' ')[0];
      const target = parseAddress(first) ? first : null;
      menu.addItem(part, null, () => target && this.jumpTo(target), sub);
    }
  }

  // ------------------------------------------------------------- hover (⋮) menu

  /** Other cells that point at this one: cells that read it, watch its size/code/clicks, or name it in their code. */
  referencesTo(address: string): string[] {
    const sheet = this.sheet;
    const found = new Set<string>();
    for (const node of [address, codeNode(address), sizeNode(address), clickNode(address)]) {
      for (const dep of sheet.dependentsOf(node)) if (dep !== address && dep !== GAME_NODE && parseAddress(dep)) found.add(dep);
    }
    const mention = new RegExp(`(^|[^A-Za-z0-9])${address}(?![A-Za-z0-9])`, 'i');
    for (const d of sheet.codeCells()) if (d.address !== address && mention.test(d.code)) found.add(d.address);
    return [...found].sort();
  }

  private cellList(addresses: string[]): MenuItem[] {
    return addresses.slice(0, 16).map((a) => ({ label: a, hint: this.sheet.dataAt(a)?.code ? this.firstWords(a) : '', onSelect: () => this.jumpToCell(a) }));
  }

  private firstWords(address: string): string {
    const line = (this.sheet.dataAt(address)?.code ?? '').split('\n').find((l) => l.trim()) ?? '';
    const text = line.replace(/^\s*\/\/\s*/, '').trim();
    return text.length > 28 ? text.slice(0, 27) + '…' : text;
  }

  private jumpToCell(address: string): void {
    const d = this.sheet.dataAt(address);
    if (!d) return;
    this.sheet.reveal(d.row, d.col);
    this.jumpTo(address);
  }

  private copy(text: string, what: string): void {
    void navigator.clipboard?.writeText(text).then(
      () => this.hooks.say(`Copied ${what} ✓`, 'good'),
      () => this.hooks.say(`Could not copy ${what} (the browser said no).`, 'bad'),
    );
  }

  private menuItemsFor(address: string): MenuItem[] | null {
    const sheet = this.sheet;
    if (sheet.isBoardAddress(address)) return null;
    const d = sheet.dataAt(address);
    if (!d) return null;
    const hasCode = d.code.trim().length > 0;
    const refs = this.referencesTo(address);
    const reads = sheet.readsOf(address).filter((r) => r !== GAME_NODE).map((r) => (parseAddress(r) ? r : describeNode(r)));
    const tasks = sheet.taskCount(address);
    const items: MenuItem[] = [];

    items.push({
      tiny: true,
      label: hasCode ? `${address} · id ${d.uid} · ran ${d.runCount}×` : `${address} · empty cell`,
      title: hasCode ? 'The id stays the same when the cell moves. Click to copy it.' : '',
      onSelect: hasCode ? () => this.copy(d.uid, 'the id') : undefined,
    });
    items.push({ label: hasCode ? '✏️ Edit code…' : '✏️ Write TypeScript here…', onSelect: () => this.editor.open(address) });
    if (hasCode) {
      items.push({ label: '▶ Run again', onSelect: () => sheet.setCode(address, d.code) });
      const { cols, rows } = d.span;
      const resize = (c: number, r: number) => () => this.resize(address, c, r);
      items.push({
        label: `⤢ Size ${cols}×${rows}`,
        children: [
          { label: 'Wider', onSelect: resize(cols + 1, rows) },
          { label: 'Narrower', disabled: cols <= 1, onSelect: resize(cols - 1, rows) },
          { label: 'Taller', onSelect: resize(cols, rows + 1) },
          { label: 'Shorter', disabled: rows <= 1, onSelect: resize(cols, rows - 1) },
          { label: 'Back to 1×1', disabled: cols <= 1 && rows <= 1, onSelect: resize(1, 1) },
        ],
      });
      if (tasks > 0) {
        items.push({
          label: `⏹ Stop timers (${tasks})`,
          onSelect: () => {
            sheet.stopTasks(address);
            sheet.notifyChanged(address);
            this.hooks.say(`Stopped the timers and watchers in ${address}.`, 'good');
          },
        });
      }
    }
    items.push({ separator: true });
    items.push({ label: `◂ Used by (${refs.length})`, disabled: refs.length === 0, children: this.cellList(refs) });
    if (hasCode) items.push({ label: `▸ Reads (${reads.length})`, disabled: reads.length === 0, children: reads.map((r) => ({ label: r, onSelect: parseAddress(r) ? () => this.jumpToCell(r) : undefined })) });
    items.push({
      label: '⧉ Copy',
      children: [
        { label: `address  ${address}`, onSelect: () => this.copy(address, 'the address') },
        { label: `path  ${workspace.pathOf(sheet.id, address)}`, title: 'Works from every tab, for example at(\'/lab/J24\')', onSelect: () => this.copy(workspace.pathOf(sheet.id, address), 'the path') },
        { label: `id  ${hasCode ? '@' + d.uid : '(no code yet)'}`, title: 'Follows the code when the cell moves', disabled: !hasCode, onSelect: () => this.copy('@' + d.uid, 'the identity') },
        { label: 'code', disabled: !hasCode, onSelect: () => this.copy(d.code, 'the code') },
      ],
    });
    items.push({
      label: 'Show ids on all cells',
      checked: this.cellMenu.idsShown,
      onSelect: () => {
        this.cellMenu.setIdsShown(!this.cellMenu.idsShown);
        this.cellMenu.refreshMenu();
        return false;
      },
    });

    if (hasCode) {
      items.push({ separator: true });
      const armed = this.deleteArmed === address;
      const block = d.span.cols > 1 || d.span.rows > 1 ? 'cell-block' : 'cell';
      if (refs.length > 0) {
        items.push({
          label: `🗑 Delete ${block}`,
          disabled: true,
          danger: true,
          hint: `used by ${refs.length}`,
          title: `Other cells point at ${address}: ${refs.slice(0, 6).join(', ')}${refs.length > 6 ? '…' : ''}. Change or delete those first.`,
        });
      } else {
        items.push({
          label: armed ? `🗑 Click again to delete ${address}` : `🗑 Delete ${block}`,
          danger: true,
          onSelect: () => {
            if (this.deleteArmed !== address) {
              this.deleteArmed = address;
              window.clearTimeout(this.deleteTimer);
              this.deleteTimer = window.setTimeout(() => {
                this.deleteArmed = null;
                this.cellMenu.refreshMenu();
              }, 3500);
              this.cellMenu.refreshMenu();
              return false;
            }
            this.deleteArmed = null;
            if (this.editor.address === address) this.editor.close(false);
            sheet.setCode(address, '');
            this.hooks.say(`Deleted the ${block} ${address}.`, 'good');
          },
        });
      }
    }
    return items;
  }
}
