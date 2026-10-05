export const SLOGAN_KEY = 'slogan-typed';
export const CHAR_MS = 35;

export interface SloganEnv {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  reducedMotion(): boolean;
  /** Resolves once the page is in front of the visitor, not just prerendered. */
  shown(): Promise<void>;
  wait(ms: number): Promise<void>;
}

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function defaultEnv(doc: Document): SloganEnv {
  return {
    storage: sessionStore(),
    reducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    shown: () =>
      (doc as Document & { prerendering?: boolean }).prerendering
        ? new Promise((resolve) =>
            doc.addEventListener('prerenderingchange', () => resolve(), { once: true }),
          )
        : Promise.resolve(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

function typedBefore(storage: SloganEnv['storage']): boolean {
  try {
    return storage?.getItem(SLOGAN_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberTyped(storage: SloganEnv['storage']): void {
  try {
    storage?.setItem(SLOGAN_KEY, '1');
  } catch {
    // Without storage, the slogan types on every page load.
  }
}

/**
 * Types the slogan out once per browser session, over a copy hidden from screen readers.
 * The slogan itself stays in the page, invisible, so the card never changes size.
 */
export async function typeSlogan(
  slogan: HTMLElement,
  env: SloganEnv = defaultEnv(slogan.ownerDocument),
): Promise<void> {
  const text = slogan.querySelector('.slogan-text')?.textContent ?? '';
  const cursor = slogan.querySelector('.cursor');
  if (!text || !cursor) return;
  await env.shown();
  if (env.reducedMotion() || typedBefore(env.storage)) return;
  rememberTyped(env.storage);

  const doc = slogan.ownerDocument;
  const typed = doc.createTextNode('');
  const overlay = doc.createElement('span');
  overlay.className = 'slogan-typed';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.append(typed, cursor.cloneNode(true));
  slogan.append(overlay);
  slogan.classList.add('typing');
  for (const char of Array.from(text)) {
    await env.wait(CHAR_MS);
    typed.data += char;
  }
  overlay.remove();
  slogan.classList.remove('typing');
}
