import { createGalleryEditor, monaco } from '../editor/monaco';

export interface GalleryExample {
  /** The cell this example lives in on the default sheet. */
  address: string;
  code: string;
}

export type GalleryTarget = 'board' | 'lab';

export interface GalleryHooks {
  /** Puts the (possibly edited) code in a cell of the chosen tab's sheet; returns the cell that got it. */
  onUse(example: GalleryExample, code: string, target: GalleryTarget): string;
}

interface Card {
  n: number;
  example: GalleryExample;
  root: HTMLElement;
  host: HTMLElement;
  model: monaco.editor.ITextModel | null;
  editor: monaco.editor.IStandaloneCodeEditor | null;
  haystack: string;
}

export function titleOf(example: GalleryExample): string {
  const first = example.code.split('\n').find((l) => l.trim()) ?? '';
  const t = first.replace(/^\/\/\s*/, '').trim();
  return t || example.address;
}

/**
 * The Examples tab: one card per example with a real Monaco editor (the same help as in a cell:
 * hover explanations, completions, the coach), a button that sends the code to the board, and a
 * search box. Editors are created only when a card scrolls into view, so opening the tab is quick.
 */
export class ExamplesGallery {
  readonly root = document.createElement('section');
  private readonly cards: Card[] = [];
  private readonly list = document.createElement('div');
  private readonly status = document.createElement('div');
  private readonly observer: IntersectionObserver;

  constructor(examples: ReadonlyArray<GalleryExample>, private readonly hooks: GalleryHooks) {
    this.root.id = 'examples';
    this.root.setAttribute('role', 'tabpanel');
    this.root.setAttribute('aria-labelledby', 'tab-examples');
    this.root.hidden = true;

    const head = document.createElement('header');
    head.className = 'gallery-head';
    const h = document.createElement('h1');
    h.textContent = 'Examples';
    const intro = document.createElement('p');
    intro.textContent = 'Change the code, hover over any word to learn what it does, then send it to the board or the Lab to watch it run in a cell.';
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search examples (try: timer, colour, plot)';
    search.setAttribute('aria-label', 'Search examples');
    search.autocomplete = 'off';
    search.spellcheck = false;
    search.addEventListener('input', () => this.filter(search.value));
    this.status.className = 'gallery-status';
    this.status.setAttribute('aria-live', 'polite');
    head.append(h, intro, search, this.status);

    this.list.className = 'gallery-list';
    this.root.append(head, this.list);

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const card = this.cards.find((c) => c.root === e.target);
          if (card) this.mount(card);
        }
      },
      { root: this.root, rootMargin: '400px 0px' },
    );

    examples.forEach((ex, i) => this.cards.push(this.buildCard(ex, i + 1)));
    for (const c of this.cards) {
      this.list.append(c.root);
      this.observer.observe(c.root);
    }
    this.filter('');
  }

  /** Editors measured while the tab was hidden need to measure themselves again. */
  relayout(): void {
    for (const c of this.cards) c.editor?.layout();
  }

  private button(text: string, className = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = text;
    return b;
  }

  private flashLabel(b: HTMLButtonElement, text: string, back: string, ms: number): void {
    b.textContent = text;
    window.setTimeout(() => (b.textContent = back), ms);
  }

  private buildCard(example: GalleryExample, n: number): Card {
    const title = titleOf(example);
    const root = document.createElement('article');
    root.className = 'gallery-card';
    const bar = document.createElement('div');
    bar.className = 'gallery-card-bar';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const tag = document.createElement('span');
    tag.className = 'gallery-tag';
    tag.textContent = `from ${example.address}`;
    tag.title = `This example lives in cell ${example.address} on the default sheet`;
    const buttons = document.createElement('div');
    buttons.className = 'gallery-buttons';
    const use = this.button('▶ Put on the board', 'gallery-use');
    const useLab = this.button('🧪 Put in the Lab', 'gallery-use lab');
    const reset = this.button('↺ Start over');
    const copy = this.button('⧉ Copy');
    buttons.append(use, useLab, reset, copy);
    bar.append(heading, tag, buttons);

    const host = document.createElement('div');
    host.className = 'gallery-editor';
    host.style.height = `${Math.max(60, example.code.split('\n').length * 19 + 12)}px`;
    root.append(bar, host);

    const card: Card = { n, example, root, host, model: null, editor: null, haystack: `${title} ${example.code}`.toLowerCase() };
    const currentCode = (): string => card.model?.getValue() ?? example.code;
    use.addEventListener('click', () => {
      const where = this.hooks.onUse(example, currentCode(), 'board');
      this.flashLabel(use, `✓ Now in ${where}`, '▶ Put on the board', 2500);
    });
    useLab.addEventListener('click', () => {
      const where = this.hooks.onUse(example, currentCode(), 'lab');
      this.flashLabel(useLab, `✓ Now in ${where}`, '🧪 Put in the Lab', 2500);
    });
    reset.addEventListener('click', () => card.model?.setValue(example.code));
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(currentCode()).then(() => this.flashLabel(copy, '✓ Copied', '⧉ Copy', 1500), () => {});
    });
    return card;
  }

  private mount(card: Card): void {
    if (card.editor) return;
    const uri = monaco.Uri.parse(`file:///gallery/ex-${card.n}.ts`);
    card.model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(card.example.code, 'typescript', uri);
    card.editor = createGalleryEditor(card.host, card.model);
    this.observer.unobserve(card.root);
  }

  private filter(query: string): void {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const c of this.cards) {
      const match = words.every((w) => c.haystack.includes(w));
      c.root.hidden = !match;
      if (match) shown++;
    }
    this.status.textContent = words.length ? `${shown} of ${this.cards.length} examples` : `${this.cards.length} examples`;
  }
}
