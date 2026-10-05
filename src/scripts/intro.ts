export const INTRO_KEY = 'intro-played';
/** Set by the head script while the intro has yet to start; src/styles/intro.css hides what it will type. */
export const PENDING_ATTR = 'data-intro-pending';
export const CHAR_MS = 35;
export const STRIKE_GAP_MS = 60;
// Keep in sync with the strike's transition in src/styles/intro.css.
export const STRIKE_MS = 200;

export interface IntroEnv {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  reducedMotion(): boolean;
  /** Whether the failsafe in src/styles/intro.css has already shown the card on screen. */
  revealed(): boolean;
  /** Resolves once the page is in front of the visitor: neither prerendered nor in a hidden tab. */
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

export function defaultEnv(doc: Document): IntroEnv {
  const inFront = () =>
    !(doc as Document & { prerendering?: boolean }).prerendering &&
    doc.visibilityState === 'visible';
  return {
    storage: sessionStore(),
    reducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    revealed: () =>
      inFront() &&
      (doc.getAnimations?.() ?? []).some(
        (animation) =>
          'animationName' in animation &&
          animation.animationName === 'intro-failsafe' &&
          animation.playState === 'finished',
      ),
    shown: () =>
      new Promise((resolve) => {
        const check = () => {
          if (!inFront()) return;
          doc.removeEventListener('prerenderingchange', check);
          doc.removeEventListener('visibilitychange', check);
          resolve();
        };
        doc.addEventListener('prerenderingchange', check);
        doc.addEventListener('visibilitychange', check);
        check();
      }),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

function playedBefore(storage: IntroEnv['storage']): boolean {
  try {
    return storage?.getItem(INTRO_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberPlayed(storage: IntroEnv['storage']): void {
  try {
    storage?.setItem(INTRO_KEY, '1');
  } catch {
    // Without storage, the intro plays on every page load.
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

/** Once per browser session, types the slogan, strikes the stack item by item, then types the note. */
export async function playIntro(
  card: HTMLElement,
  env: IntroEnv = defaultEnv(card.ownerDocument),
): Promise<void> {
  const slogan = card.querySelector<HTMLElement>('[data-slogan]');
  const note = card.querySelector<HTMLElement>('[data-note]');
  const items = [...card.querySelectorAll<HTMLElement>('[data-stack] s')];
  const cursor = card.querySelector('.cursor');
  const sloganText = slogan?.querySelector('.slogan-text')?.textContent ?? '';
  const noteText = note?.querySelector('.note-text')?.textContent ?? '';
  const clearPending = () => card.ownerDocument.documentElement.removeAttribute(PENDING_ATTR);
  if (!cursor || (!sloganText && items.length === 0 && !noteText)) {
    clearPending();
    return;
  }
  // Asked before the wait, so a page that was hidden or prerendered meanwhile still plays.
  const revealed = env.revealed();
  await env.shown();
  if (revealed || env.reducedMotion() || playedBefore(env.storage)) {
    clearPending();
    return;
  }
  rememberPlayed(env.storage);

  const overlays: HTMLElement[] = [];
  // Types over the text, which stays in the page for screen readers and keeps the card's size.
  const typeOut = async (container: HTMLElement, text: string) => {
    const doc = container.ownerDocument;
    const typed = doc.createTextNode('');
    const caret = cursor.cloneNode(true) as HTMLElement;
    const overlay = doc.createElement('span');
    overlay.className = 'typed';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.append(typed, caret);
    overlays.push(overlay);
    container.append(overlay);
    container.classList.add('typing');
    for (const char of Array.from(text)) {
      await env.wait(CHAR_MS);
      typed.data += char;
      // A transform, unlike a caret in the text flow, moves without counting as a layout shift.
      const [x, y] = caretOffset(overlay, typed, char);
      caret.style.transform = `translate(${x}px, ${y}px)`;
    }
    return overlay;
  };
  const finish = (container: HTMLElement | null, overlay: HTMLElement | undefined) => {
    overlay?.remove();
    container?.classList.remove('typing');
  };

  card.classList.add('intro');
  // typeOut adds .typing before its first wait, so nothing shows in between.
  clearPending();
  try {
    let parked: HTMLElement | undefined;
    if (slogan && sloganText) {
      parked = await typeOut(slogan, sloganText);
      if (noteText) parked.classList.add('parked');
      else finish(slogan, parked);
    }
    for (const [index, item] of items.entries()) {
      if (index > 0) await env.wait(STRIKE_GAP_MS);
      item.setAttribute('data-drawn', '');
    }
    if (items.length > 0) await env.wait(STRIKE_MS);
    if (note && noteText) {
      finish(slogan, parked);
      finish(note, await typeOut(note, noteText));
    }
  } finally {
    for (const overlay of overlays) overlay.remove();
    for (const container of [slogan, note]) container?.classList.remove('typing');
    for (const item of items) item.removeAttribute('data-drawn');
    card.classList.remove('intro');
  }
}
