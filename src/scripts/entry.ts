import type { Help } from './help';
import type { Palette } from './palette';
import { initShortcuts, singleKeysSwitch } from './shortcuts';
import { playIntro } from './intro';
import { initTheme } from './theme';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const store = storage();
const theme = initTheme(document, {
  storage: store,
  media: matchMedia('(prefers-color-scheme: dark)'),
});
const singleKeys = singleKeysSwitch(store);
const navigate = (href: string) => location.assign(href);

const paletteDialog = document.querySelector<HTMLDialogElement>('dialog[data-palette]');
const helpDialog = document.querySelector<HTMLDialogElement>('dialog[data-help]');
let palette: Promise<Palette> | undefined;
let help: Promise<Help> | undefined;
let failedLoads = 0;

function afterFailedLoad(): void {
  failedLoads += 1;
  // Chromium keeps a failed import for the page's life; after a deploy, only new HTML names the new chunks.
  if (failedLoads > 1 && navigator.onLine) location.reload();
}

function openHelp(): void {
  if (!helpDialog) return;
  help ??= import('./help').then(({ setupHelp }) => setupHelp(helpDialog, singleKeys));
  void help.then(
    (ready) => ready.open(),
    () => {
      help = undefined;
      afterFailedLoad();
    },
  );
}

function openPalette(): Promise<void> {
  if (!paletteDialog) return Promise.reject(new Error('This page has no command palette'));
  palette ??= import('./palette').then(({ setupPalette }) =>
    setupPalette(paletteDialog, {
      theme,
      navigate,
      // async: on a non-secure page there is no clipboard, and the palette reports a rejection.
      copy: async (text) => navigator.clipboard.writeText(text),
      openHelp,
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

const showPalette = () => {
  if (paletteDialog) void openPalette().catch(afterFailedLoad);
};

for (const button of document.querySelectorAll('[data-palette-open]'))
  button.addEventListener('click', showPalette);
const menu = document.querySelector<HTMLDetailsElement>('.site-menu');
const menuButton = menu?.querySelector('summary');
if (menu && menuButton) {
  // Only here does the summary open a dialog; without the script it stays the <details> toggle.
  menuButton.setAttribute('role', 'button');
  menuButton.setAttribute('aria-haspopup', 'dialog');
  menuButton.addEventListener('click', (event) => {
    // Closing the fallback menu must not wait for another attempt to load the palette.
    if (menu.open) return;
    event.preventDefault();
    void openPalette().catch(() => {
      menu.open = true;
    });
  });
}
initShortcuts(document, {
  singleKeys,
  openPalette: showPalette,
  openHelp,
  cycleTheme: theme.cycle,
  navigate,
});
const intro = document.querySelector<HTMLElement>('[data-intro]');
if (intro) void playIntro(intro);
if (!/Mac|iPhone|iPad/.test(navigator.platform)) {
  for (const key of document.querySelectorAll('[data-palette-open] kbd'))
    key.textContent = 'Ctrl K';
}
