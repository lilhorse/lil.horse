import { describe, expect, it } from 'vitest';
import { render } from '../helpers/astro-render';
import Scoped from './fixtures/Scoped.astro';

describe('render', () => {
  it('passes slots and drops the scoped-style attributes', async () => {
    const html = await render(Scoped, { label: 'a' }, undefined, { default: '<b>b</b>' });
    expect(html).toBe('<p class="scoped">a <b>b</b></p>');
  });
});
