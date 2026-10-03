import { describe, expect, it } from 'vitest';
import { htmlLang, langOfText } from '../../src/lib/lang';

describe('htmlLang', () => {
  it('marks Chinese and leaves English to the page', () => {
    expect(htmlLang('zh')).toBe('zh-Hans');
    expect(htmlLang('en')).toBeUndefined();
  });
});

describe('langOfText', () => {
  it('detects Han characters anywhere in the text', () => {
    expect(langOfText('豆瓣')).toBe('zh-Hans');
    expect(langOfText('My 豆瓣 backup')).toBe('zh-Hans');
    expect(langOfText('AI')).toBeUndefined();
    expect(langOfText('🎬')).toBeUndefined();
  });
});
