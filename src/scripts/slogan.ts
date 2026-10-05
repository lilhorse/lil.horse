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

/** The end of the typed text, from the overlay's top left, with the line snapped to the line height. */
function caretOffset(overlay: HTMLElement, typed: Text, lastChar: string): [number, number] {
  const range = overlay.ownerDocument.createRange();
  range.setStart(typed, typed.length - lastChar.length);
  range.setEnd(typed, typed.length);
  const rects = range.getClientRects();
  const rect = rects[rects.length - 1];
  if (!rect) return [0, 0];
  const box = overlay.getBoundingClientRect();
  const top = rect.top - box.top;
  const line = Number.parseFloat(getComputedStyle(overlay).lineHeight);
  return [rect.right - box.left, line > 0 ? Math.round(top / line) * line : top];
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
  const caret = cursor.cloneNode(true) as HTMLElement;
  const overlay = doc.createElement('span');
  overlay.className = 'slogan-typed';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.append(typed, caret);
  slogan.append(overlay);
  slogan.classList.add('typing');
  for (const char of Array.from(text)) {
    await env.wait(CHAR_MS);
    typed.data += char;
    // A transform, unlike a caret in the text flow, moves without counting as a layout shift.
    const [x, y] = caretOffset(overlay, typed, char);
    caret.style.transform = `translate(${x}px, ${y}px)`;
  }
  overlay.remove();
  slogan.classList.remove('typing');
}
