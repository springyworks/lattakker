import { Graph, InternalEvent, type EventObject, type Cell } from '@maxgraph/core';
import { THEME } from '../theme';
import { buttonHtml, turnHtml, type HudSnapshot } from './Hud';

const COLLAPSED_H = 52;
const BUTTON_H = 46;
const GAP = 6;
const PAD = 8;
const MESSAGE_H = 46;

/**
 * Small-screen control strip: a second maxGraph graph fixed to the bottom edge. It mirrors the HUD
 * (turn banner, latest message, buttons) at a constant pixel size, and slides between a one-line
 * collapsed state and an expanded state that shows the message and every button.
 */
export class Dock {
  private readonly host: HTMLDivElement;
  private readonly graph: Graph;
  private snap: HudSnapshot | null = null;
  private expanded = true;

  constructor(
    private onPress: (id: string) => void,
    private onResize: () => void,
  ) {
    this.host = document.createElement('div');
    this.host.id = 'dock';
    document.body.appendChild(this.host);
    document.body.classList.add('has-dock');

    this.graph = new Graph(this.host, undefined, []);
    this.graph.setHtmlLabels(true);
    this.graph.setCellsMovable(false);
    this.graph.setCellsSelectable(false);
    this.graph.setCellsEditable(false);
    this.graph.setCellsResizable(false);
    this.graph.setConnectable(false);
    this.graph.setTooltips(false);

    this.graph.addListener(InternalEvent.CLICK, (_sender: unknown, evt: EventObject) => {
      const cell = evt.getProperty('cell') as Cell | null | undefined;
      const id = cell?.getId() ?? '';
      if (id === 'dock:toggle') {
        this.expanded = !this.expanded;
        this.render();
      } else if (id.startsWith('btn:')) {
        this.onPress(id);
      }
    });
    window.addEventListener('resize', () => this.render());
  }

  update(snap: HudSnapshot): void {
    this.snap = snap;
    this.render();
  }

  private render(): void {
    if (!this.snap) return;
    const snap = this.snap;
    const width = window.innerWidth;
    const visible = snap.buttons.filter((b) => b.visible);
    const perRow = width < 340 ? 2 : 3;
    const rows = Math.ceil(visible.length / perRow);
    const height = this.expanded ? COLLAPSED_H + MESSAGE_H + PAD + rows * (BUTTON_H + GAP) + PAD : COLLAPSED_H;

    this.host.style.height = `${height}px`;
    document.documentElement.style.setProperty('--dock-h', `${height}px`);
    const turn = snap.turnColor === 'red' ? THEME.turnRed : snap.turnColor === 'blue' ? THEME.turnBlue : THEME.turnNone;
    const tone = THEME.tone[snap.tone];
    const hint = this.expanded ? 'Tap here to hide the controls' : 'Controls are hidden. Tap here to show them';

    const model = this.graph.getDataModel();
    model.beginUpdate();
    try {
      const root = this.graph.getDefaultParent();
      this.graph.removeCells(this.graph.getChildCells(root, true, true), false);
      this.graph.insertVertex({
        parent: root,
        id: 'dock:toggle',
        value: turnHtml(snap.turnText, `${snap.turnSub ? `${snap.turnSub}. ` : ''}${hint}`, turn.stroke),
        position: [PAD, 2],
        size: [width - 2 * PAD, COLLAPSED_H - 4],
        style: { fillColor: turn.fill, strokeColor: 'none', strokeWidth: 0, rounded: false, align: 'left', verticalAlign: 'middle', fontFamily: 'system-ui, sans-serif' },
      });
      if (this.expanded) {
        this.graph.insertVertex({
          parent: root,
          id: 'dock:message',
          value: snap.message.length > 140 ? `${snap.message.slice(0, 137)}...` : snap.message,
          position: [PAD, COLLAPSED_H],
          size: [width - 2 * PAD, MESSAGE_H],
          style: { fillColor: tone.fill, strokeColor: tone.stroke, strokeWidth: 1, rounded: true, arcSize: 8, fontColor: THEME.ink, fontSize: 12, whiteSpace: 'wrap', overflow: 'hidden', align: 'left', verticalAlign: 'middle', spacingLeft: 8, spacingRight: 8, fontFamily: 'system-ui, sans-serif', pointerEvents: false },
        });
        const bw = (width - 2 * PAD - (perRow - 1) * GAP) / perRow;
        visible.forEach((b, i) => {
          this.graph.insertVertex({
            parent: root,
            id: b.id,
            value: buttonHtml(b.label, b.status),
            position: [PAD + (i % perRow) * (bw + GAP), COLLAPSED_H + MESSAGE_H + PAD + Math.floor(i / perRow) * (BUTTON_H + GAP)],
            size: [bw, BUTTON_H],
            style: { fillColor: b.id === 'btn:start' ? THEME.go : b.id === 'btn:new' || b.id === 'btn:code' ? THEME.primary : THEME.neutral, strokeColor: 'none', rounded: true, arcSize: 20, fontColor: '#ffffff', fontSize: 13, whiteSpace: 'wrap', fontFamily: 'system-ui, sans-serif' },
          });
        });
      }
    } finally {
      model.endUpdate();
    }
    this.onResize();
  }
}
