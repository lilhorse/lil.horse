import { INTRO_KEY, PENDING_ATTR } from '../scripts/intro';
import { BAR_COLORS, THEME_KEY } from '../scripts/theme';

/** Inline in <head>, so that before the first paint a stored theme wins and what the intro will type is hidden. */
export const THEME_INIT_SCRIPT = [
  `(()=>{let p="system";try{const v=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(v==="light"||v==="dark")p=v}catch{}`,
  'const t=p==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p;',
  'const h=document.documentElement;h.dataset.theme=t;h.dataset.themePref=p;',
  `let i=null;try{i=sessionStorage.getItem(${JSON.stringify(INTRO_KEY)})}catch{}`,
  `if(i!=="1"&&!matchMedia("(prefers-reduced-motion: reduce)").matches)h.setAttribute(${JSON.stringify(PENDING_ATTR)},"");`,
  `if(p!=="system"){const c=t==="dark"?${JSON.stringify(BAR_COLORS.dark)}:${JSON.stringify(BAR_COLORS.light)};`,
  `for(const m of document.querySelectorAll('meta[name="theme-color"]'))m.setAttribute("content",c)}})();`,
].join('');
