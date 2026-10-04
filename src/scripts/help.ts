import { setShortcutsEnabled, shortcutsEnabled } from './shortcuts';

export interface Help {
  open(): void;
}

export function setupHelp(
  dialog: HTMLDialogElement,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
): Help {
  const toggle = dialog.querySelector<HTMLInputElement>('[data-shortcuts-toggle]');
  toggle?.addEventListener('change', () => setShortcutsEnabled(storage, toggle.checked));
  dialog.addEventListener('click', (event) => {
    const target = event.target as Element;
    if (target.closest('[data-help-close]') || target === dialog) dialog.close();
  });
  return {
    open() {
      if (toggle) toggle.checked = shortcutsEnabled(storage);
      if (!dialog.open) dialog.showModal();
    },
  };
}
