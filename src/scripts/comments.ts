import type { Theme } from './theme';

export type { Theme };

export const GISCUS_ORIGIN = 'https://giscus.app';
export const NEAR_PX = 600;

export interface CommentsEnv {
  doc: Document;
  theme(): Theme;
  observe(target: Element, onNear: () => void): void;
  prerendered(): Promise<void>;
}

export function themeUrl(container: HTMLElement, theme: Theme): string {
  const value =
    (theme === 'dark' ? container.dataset.themeDark : container.dataset.themeLight) ?? theme;
  // Whichever host serves the build (lil.horse, workers.dev, a version URL) serves its stylesheets too.
  return value.startsWith('/')
    ? new URL(value, container.ownerDocument.location.origin).href
    : value;
}

export function giscusScript(
  doc: Document,
  container: HTMLElement,
  theme: string,
): HTMLScriptElement {
  const script = doc.createElement('script');
  script.src = `${GISCUS_ORIGIN}/client.js`;
  script.async = true;
  script.crossOrigin = 'anonymous';
  const settings: Record<string, string | undefined> = {
    repo: container.dataset.repo,
    'repo-id': container.dataset.repoId,
    category: container.dataset.category,
    'category-id': container.dataset.categoryId,
    mapping: 'specific',
    term: container.dataset.term,
    strict: '1',
    'reactions-enabled': '1',
    'emit-metadata': '0',
    'input-position': 'top',
    theme,
    lang: 'en',
  };
  for (const [name, value] of Object.entries(settings))
    if (value !== undefined) script.setAttribute(`data-${name}`, value);
  return script;
}

export function defaultEnv(doc: Document): CommentsEnv {
  return {
    doc,
    theme: () => (doc.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
    observe(target, onNear) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer.disconnect();
          onNear();
        },
        { rootMargin: `${NEAR_PX}px 0px` },
      );
      observer.observe(target);
    },
    // A prerendered page must not spend a Giscus load before anyone looks at it.
    prerendered: () =>
      (doc as Document & { prerendering?: boolean }).prerendering
        ? new Promise((resolve) =>
            doc.addEventListener('prerenderingchange', () => resolve(), { once: true }),
          )
        : Promise.resolve(),
  };
}

/** Inserts Giscus once the section comes near the viewport, then keeps its theme in step with the site. */
export function setupComments(
  container: HTMLElement,
  env: CommentsEnv = defaultEnv(container.ownerDocument),
): void {
  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    container.append(giscusScript(env.doc, container, themeUrl(container, env.theme())));
  };
  void env.prerendered().then(() => env.observe(container, load));
  env.doc.addEventListener('themechange', () => {
    const frame = container.querySelector<HTMLIFrameElement>('iframe.giscus-frame');
    frame?.contentWindow?.postMessage(
      { giscus: { setConfig: { theme: themeUrl(container, env.theme()) } } },
      GISCUS_ORIGIN,
    );
  });
}
