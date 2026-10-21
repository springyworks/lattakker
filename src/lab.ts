import type { GameView } from './game/GameView';
import { LAB_DEMOS, TERMINAL_DEMOS } from './labDemos';
import { upgradeLabStorage } from './labLayout';
import { loadLabSaved, saveLabSaved, startLabAutoSave } from './storage';
import { createSheetTab, type SheetTab } from './sheetTab';

export type Lab = SheetTab & {
  /** Puts every demo back as written (cells of your own are left alone). */
  restoreDemos(): number;
};

/**
 * The Lab tab: a second sheet with the same abilities as the one under the game board, filled with live demos
 * (see sheetTab.ts). It has no game board of its own: `game` in its code is the one game on the first tab.
 */
export function createLab(view: GameView, smallScreen: boolean): Lab {
  const tab = createSheetTab(view, smallScreen, {
    id: 'lab',
    title: 'Lab',
    icon: '🧪',
    intro: 'Live demos. Double-click a block to change it, hover its ⋮ for a menu.',
    seed: LAB_DEMOS,
    restoreLabel: '↺ Restore demos',
    restoreHint: 'Put every demo back as it was written (your own cells stay)',
    containerId: 'lab',
    panelId: 'lab-panel',
    // The terminal at A1 before it learned input.onPaste, before Ctrl-C skipped the slow typing, and before the AI command.
    olderVersions: { A1: ['a408c3cb', 'ae1b9f14', '7b4a89e0'] },
    load: () => upgradeLabStorage(loadLabSaved(), TERMINAL_DEMOS[0][1], saveLabSaved),
    startSave: startLabAutoSave,
  });
  return Object.assign(tab, { restoreDemos: tab.restoreSeed });
}
