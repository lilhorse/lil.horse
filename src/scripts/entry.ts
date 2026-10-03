import { initTheme } from './theme';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

initTheme(document, { storage: storage(), media: matchMedia('(prefers-color-scheme: dark)') });
