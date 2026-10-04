import type { SingleKeys } from './shortcuts';

export interface Help {
  open(): void;
}

export function setupHelp(dialog: HTMLDialogElement, singleKeys: SingleKeys): Help {
  const toggle = dialog.querySelector<HTMLInputElement>('[data-shortcuts-toggle]');
  toggle?.addEventListener('change', () => singleKeys.set(toggle.checked));
  dialog.addEventListener('click', (event) => {
    const target = event.target as Element;
    if (target.closest('[data-help-close]') || target === dialog) dialog.close();
  });
  return {
    open() {
      if (toggle) toggle.checked = singleKeys.enabled();
      if (!dialog.open) dialog.showModal();
    },
  };
}
