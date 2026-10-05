import { expect, it, vi } from 'vitest';
import { SLOGAN_KEY } from '../../src/scripts/slogan';

it('types the home page slogan once the page loads', async () => {
  document.body.innerHTML =
    '<p class="slogan" data-slogan><span class="slogan-text">Hi</span><span class="cursor" aria-hidden="true">▋</span></p>';
  sessionStorage.clear();
  await import('../../src/scripts/entry');
  await vi.waitFor(() => expect(document.querySelector('.slogan-typed')).not.toBeNull());
  await vi.waitFor(() => expect(document.querySelector('.slogan-typed')).toBeNull());
  expect(sessionStorage.getItem(SLOGAN_KEY)).toBe('1');
});
