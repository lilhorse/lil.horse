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

function openPalette(): void {
  if (!dialog) return;
  palette ??= import('./palette').then(({ setupPalette }) =>
    setupPalette(dialog, {
      theme,
      navigate: (href) => location.assign(href),
      copy: (text) => navigator.clipboard.writeText(text),
    }),
  );
  void palette.then((ready) => ready.open());
}

for (const button of document.querySelectorAll('[data-palette-open]'))
  button.addEventListener('click', openPalette);
document.querySelector('.site-menu summary')?.addEventListener('click', (event) => {
  event.preventDefault();
  openPalette();
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openPalette();
  } else if (
    event.key === '/' &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !isEditable(event.target) &&
    !dialog?.open
  ) {
    event.preventDefault();
    openPalette();
  }
});
if (!/Mac|iPhone|iPad/.test(navigator.platform)) {
  for (const key of document.querySelectorAll('[data-palette-open] kbd'))
    key.textContent = 'Ctrl K';
}
