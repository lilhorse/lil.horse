import { expect, it, vi } from 'vitest';
import { INTRO_KEY } from '../../src/scripts/intro';

it('plays the home page intro once the page loads', async () => {
  document.body.innerHTML =
    '<div class="neofetch" data-intro><p class="slogan" data-slogan><span class="slogan-text">Hi</span><span class="cursor" aria-hidden="true">▋</span></p></div>';
  sessionStorage.clear();
  await import('../../src/scripts/entry');
  await vi.waitFor(() => expect(document.querySelector('.typed')).not.toBeNull());
  await vi.waitFor(() => expect(document.querySelector('.typed')).toBeNull());
  expect(sessionStorage.getItem(INTRO_KEY)).toBe('1');
});
