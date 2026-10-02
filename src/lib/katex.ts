import katex, { type KatexOptions } from 'katex';

export const KATEX_STYLESHEET = `/katex/${katex.version}/katex.min.css`;

export const KATEX_OPTIONS: KatexOptions = {
  output: 'htmlAndMathml',
  throwOnError: false,
  // CJK in math is routine here, and 'warn' would log one line per character.
  strict: (code) => (code === 'unicodeTextInMathMode' ? 'ignore' : 'warn'),
};
