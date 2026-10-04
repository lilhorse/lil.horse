import { loadPagefind, runSearch, type SearchResult, type Searcher } from './search';
import { nextPref, type ThemeController, type ThemePref } from './theme';

export interface PaletteDeps {
  theme: ThemeController;
  navigate(href: string): void;
  copy(text: string): Promise<void>;
  loadSearch?(): Promise<Searcher | null>;
  openHelp?(): void;
  debounceMs?: number;
}

export interface Palette {
  open(): void;
  close(): void;
}

const RESULT_LIMIT = 8;

function must<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`The command palette is missing ${selector}`);
  return found;
}

export function setupPalette(dialog: HTMLDialogElement, deps: PaletteDeps): Palette {
  const doc = dialog.ownerDocument;
  const input = must<HTMLInputElement>(dialog, 'input[role="combobox"]');
  const results = must<HTMLElement>(dialog, '[data-results]');
  const resultsGroup = must<HTMLElement>(dialog, '[data-group="results"]');
  const empty = must<HTMLElement>(dialog, '[data-group="empty"]');
  const staticGroups = [...dialog.querySelectorAll<HTMLElement>('[data-group]')].filter(
    (group) => group !== resultsGroup && group !== empty,
  );
  let active: HTMLElement | null = null;
  let searcher: Promise<Searcher | null> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest = 0;

  const email = () => `${dialog.dataset.emailUser ?? ''}@${dialog.dataset.emailHost ?? ''}`;
  const options = () =>
    [...dialog.querySelectorAll<HTMLElement>('[role="option"]')].filter(
      (option) => !option.hidden && !option.closest('[hidden]'),
    );

  function setActive(option: HTMLElement | null): void {
    active?.setAttribute('aria-selected', 'false');
    active = option;
    if (!option) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    option.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView?.({ block: 'nearest' });
  }

  function filterStatic(query: string): void {
    const needle = query.trim().toLowerCase();
    for (const group of staticGroups) {
      let shown = 0;
      for (const option of group.querySelectorAll<HTMLElement>('[role="option"]')) {
        const text = `${option.textContent ?? ''} ${option.dataset.keywords ?? ''}`.toLowerCase();
        option.hidden = needle !== '' && !text.includes(needle);
        if (!option.hidden) shown += 1;
      }
      group.hidden = shown === 0;
    }
  }

  function renderResults(items: SearchResult[], note: string | null = null): void {
    results.replaceChildren(
      ...items.map((item, index) => {
        const option = doc.createElement('li');
        option.setAttribute('role', 'option');
        option.id = `palette-result-${index}`;
        option.dataset.href = item.href;
        const title = doc.createElement('span');
        title.className = 'label';
        title.textContent = item.title;
        if (item.lang) title.lang = item.lang;
        option.append(title);
        const excerpt = doc.createElement('span');
        excerpt.className = 'excerpt';
        excerpt.innerHTML = item.excerpt;
        if (item.lang) excerpt.lang = item.lang;
        if (item.date) {
          const date = doc.createElement('span');
          date.className = 'meta';
          date.textContent = item.date;
          option.append(' ', date);
        }
        option.append(excerpt);
        return option;
      }),
    );
    if (note) {
      const line = doc.createElement('li');
      line.className = 'note';
      line.textContent = note;
      results.append(line);
    }
    resultsGroup.hidden = items.length === 0 && !note;
  }

  function updateEmpty(): void {
    empty.hidden = options().length > 0 || !resultsGroup.hidden;
  }

  async function runQuery(query: string): Promise<void> {
    const id = ++latest;
    let items: SearchResult[] = [];
    let note: string | null = null;
    if (query.trim()) {
      searcher ??= (deps.loadSearch ?? loadPagefind)();
      const engine = await searcher;
      if (id !== latest) return;
      items = engine ? await runSearch(engine, query, RESULT_LIMIT) : [];
      if (id !== latest) return;
      if (!engine) note = 'Search is not available on this page.';
    }
    renderResults(items, note);
    updateEmpty();
    if (!active || !options().includes(active)) setActive(options()[0] ?? null);
  }

  function onInput(): void {
    const query = input.value;
    filterStatic(query);
    setActive(options()[0] ?? null);
    updateEmpty();
    clearTimeout(timer);
    timer = setTimeout(() => void runQuery(query), deps.debounceMs ?? 150);
  }

  function flash(option: HTMLElement, text: string): void {
    const label = option.querySelector<HTMLElement>('.label') ?? option;
    const previous = label.textContent;
    if (previous === text) return;
    label.textContent = text;
    setTimeout(() => {
      label.textContent = previous;
    }, 1500);
  }

  function run(option: HTMLElement): void {
    const { href, action } = option.dataset;
    if (href) {
      close();
      deps.navigate(href);
      return;
    }
    switch (action) {
      case 'theme':
        deps.theme.cycle();
        break;
      case 'copy-email':
        void deps.copy(email()).then(() => flash(option, 'Copied'));
        break;
      case 'email':
        close();
        deps.navigate(`mailto:${email()}`);
        break;
      case 'help':
        close();
        deps.openHelp?.();
        break;
    }
  }

  function move(delta: number): void {
    const list = options();
    if (list.length === 0) return;
    const index = active ? list.indexOf(active) : -1;
    setActive(list[(index + delta + list.length) % list.length] ?? null);
  }

  function syncTheme(): void {
    const pref = deps.theme.pref();
    for (const button of dialog.querySelectorAll<HTMLElement>('[data-theme-set]'))
      button.setAttribute('aria-pressed', String(button.dataset.themeSet === pref));
    const hint = dialog.querySelector<HTMLElement>('[data-theme-hint]');
    if (hint) hint.textContent = `${pref} → ${nextPref(pref)}`;
  }

  function open(): void {
    if (dialog.open) {
      input.focus();
      return;
    }
    clearTimeout(timer);
    latest += 1;
    input.value = '';
    filterStatic('');
    renderResults([]);
    setActive(options()[0] ?? null);
    updateEmpty();
    syncTheme();
    dialog.showModal();
    input.focus();
  }

  function close(): void {
    if (dialog.open) dialog.close();
  }

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', (event) => {
    // keyCode 229: Safari reports the Enter that commits an IME composition as no longer composing.
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown') move(1);
    else if (event.key === 'ArrowUp') move(-1);
    else if (event.key === 'Enter') {
      const target = active ?? options()[0];
      if (target) run(target);
    } else return;
    event.preventDefault();
  });
  dialog.addEventListener('click', (event) => {
    const target = event.target as Element;
    const option = target.closest<HTMLElement>('[role="option"]');
    if (option) run(option);
    else if (target.closest('[data-palette-close]') || target === dialog) close();
  });
  for (const button of dialog.querySelectorAll<HTMLElement>('[data-theme-set]')) {
    button.addEventListener('click', () => deps.theme.set(button.dataset.themeSet as ThemePref));
  }
  doc.addEventListener('themechange', syncTheme);
  return { open, close };
}
