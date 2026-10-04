import type { Palette } from './palette';
import { initTheme } from './theme';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

const theme = initTheme(document, {
  storage: storage(),
  media: matchMedia('(prefers-color-scheme: dark)'),
});

const dialog = document.querySelector<HTMLDialogElement>('dialog[data-palette]');
let palette: Promise<Palette> | undefined;

function openPalette(): Promise<void> {
  if (!dialog) return Promise.reject(new Error('This page has no command palette'));
  palette ??= import('./palette').then(({ setupPalette }) =>
    setupPalette(dialog, {
      theme,
      navigate: (href) => location.assign(href),
      copy: (text) => navigator.clipboard.writeText(text),
    }),
  );
  return palette.then(
    (ready) => ready.open(),
    (error: unknown) => {
      palette = undefined;
      throw error;
    },
  );
}

const ignore = () => undefined;

for (const button of document.querySelectorAll('[data-palette-open]'))
  button.addEventListener('click', () => void openPalette().catch(ignore));
const menu = document.querySelector<HTMLDetailsElement>('.site-menu');
menu?.querySelector('summary')?.addEventListener('click', (event) => {
  // Closing the fallback menu must not wait for another attempt to load the palette.
  if (menu.open) return;
  event.preventDefault();
  void openPalette().catch(() => {
    menu.open = true;
  });
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    void openPalette().catch(ignore);
  } else if (
    event.key === '/' &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !isEditable(event.target) &&
    !dialog?.open
  ) {
    event.preventDefault();
    void openPalette().catch(ignore);
  }
});
if (!/Mac|iPhone|iPad/.test(navigator.platform)) {
  for (const key of document.querySelectorAll('[data-palette-open] kbd'))
    key.textContent = 'Ctrl K';
}
