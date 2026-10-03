import { BAR_COLORS, THEME_KEY } from '../scripts/theme';

/** Inline in <head>: a stored preference must win before the first paint, or the page flashes the other theme. */
export const THEME_INIT_SCRIPT = [
  `(()=>{let p="system";try{const v=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(v==="light"||v==="dark")p=v}catch{}`,
  'const t=p==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p;',
  'const h=document.documentElement;h.dataset.theme=t;h.dataset.themePref=p;',
  `if(p!=="system"){const c=t==="dark"?${JSON.stringify(BAR_COLORS.dark)}:${JSON.stringify(BAR_COLORS.light)};`,
  `for(const m of document.querySelectorAll('meta[name="theme-color"]'))m.setAttribute("content",c)}})();`,
].join('');
