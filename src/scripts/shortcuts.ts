export const SHORTCUTS_KEY = 'shortcuts';
export const GO: Record<string, string> = { h: '/', b: '/blog', p: '/projects', a: '/about' };
const SEQUENCE_MS = 1000;

export interface ShortcutDeps {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  openPalette(): void;
  openHelp(): void;
  cycleTheme(): void;
  navigate(href: string): void;
  now?(): number;
}

export function shortcutsEnabled(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(SHORTCUTS_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setShortcutsEnabled(storage: Pick<Storage, 'setItem'> | null, on: boolean): void {
  try {
    storage?.setItem(SHORTCUTS_KEY, on ? 'on' : 'off');
  } catch {
    // Storage can refuse writes; the shortcuts then stay as they were.
  }
}

export function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

/** ⌘K and Ctrl+K always work; the single keys stop while typing, while a dialog is open, or when switched off. */
export function initShortcuts(doc: Document, deps: ShortcutDeps): () => void {
  const now = deps.now ?? Date.now;
  let pendingGo = 0;
  const onKeydown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      deps.openPalette();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
    if (isEditable(event.target) || doc.querySelector('dialog[open]')) return;
    if (!shortcutsEnabled(deps.storage)) return;
    const time = now();
    if (pendingGo && time - pendingGo <= SEQUENCE_MS) {
      pendingGo = 0;
      const href = GO[event.key];
      if (href) {
        event.preventDefault();
        deps.navigate(href);
        return;
      }
    }
    pendingGo = 0;
    switch (event.key) {
      case '/':
        event.preventDefault();
        deps.openPalette();
        break;
      case 'g':
        pendingGo = time;
        break;
      case 't':
        deps.cycleTheme();
        break;
      case '?':
        event.preventDefault();
        deps.openHelp();
        break;
      case '[':
      case ']': {
        const rel = event.key === '[' ? 'prev' : 'next';
        const link = doc.querySelector<HTMLAnchorElement>(`a[rel~="${rel}"]`);
        if (link) deps.navigate(link.href);
        break;
      }
    }
  };
  doc.addEventListener('keydown', onKeydown);
  return () => doc.removeEventListener('keydown', onKeydown);
}
