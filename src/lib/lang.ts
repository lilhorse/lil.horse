import type { Language } from '../notion/types';

/** Pages are lang="en", so only Chinese text needs a lang of its own. */
export function htmlLang(language: Language): 'zh-Hans' | undefined {
  return language === 'zh' ? 'zh-Hans' : undefined;
}

/** For text without a declared language, such as tag names. */
export function langOfText(text: string): 'zh-Hans' | undefined {
  return /\p{Script=Han}/u.test(text) ? 'zh-Hans' : undefined;
}
