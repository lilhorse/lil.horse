import { describe, expect, it } from 'vitest';
import CodeBlock from '../../src/components/blocks/CodeBlock.astro';
import type { CodeNode } from '../../src/notion/types';
import { htmlErrors, render } from '../helpers/astro-render';

const code = (overrides: Partial<CodeNode>): CodeNode => ({
  type: 'code',
  id: 'c',
  language: 'bash',
  code: 'echo "hi"',
  caption: [],
  frame: 'terminal',
  title: null,
  ...overrides,
});

const span = (colours: string, text: string) => `<span style="${colours}">${text}</span>`;
const FUNCTION = '--0:#7AA2F7;--1:#1F4FD6';
const STRING = '--0:#9ECE6A;--1:#2F7A2F';
const TEXT = '--0:#C0CAF5;--1:#1F1B16';

describe('CodeBlock', () => {
  it('frames shell code as a terminal in the exact colours of both themes', async () => {
    const html = await render(CodeBlock, { node: code({}), resolve: () => undefined });
    expect(html).toContain('<figure class="frame is-terminal">');
    expect(html).toContain('<span style="--0:#9ECE6A;--1:#2F7A2F">"hi"</span>');
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('names an editor frame after the file', async () => {
    const html = await render(CodeBlock, {
      node: code({ language: 'ts', code: 'const a = 1;', frame: 'editor', title: 'src/a.ts' }),
      resolve: () => undefined,
    });
    expect(html).toContain('<span class="title">src/a.ts</span>');
  });

  it('gives a Python call the function colour on its name only', async () => {
    const html = await render(CodeBlock, {
      node: code({ language: 'python', code: 'print("hi")', frame: 'none' }),
      resolve: () => undefined,
    });
    expect(html).toContain(
      span(FUNCTION, 'print') + span(TEXT, '(') + span(STRING, '"hi"') + span(TEXT, ')'),
    );
  });

  it('keeps the function colour on a JavaScript method name', async () => {
    const html = await render(CodeBlock, {
      node: code({ language: 'javascript', code: 'console.log(x)', frame: 'none' }),
      resolve: () => undefined,
    });
    expect(html).toContain(span(FUNCTION, 'log'));
  });
});
