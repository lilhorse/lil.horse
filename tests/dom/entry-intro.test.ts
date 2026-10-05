import { expect, it, vi } from 'vitest';
import { INTRO_KEY } from '../../src/scripts/intro';

it('clears the pending mark on a page without the intro', async () => {
  document.body.innerHTML = '<main><p>About</p></main>';
  document.documentElement.dataset.introPending = '';
  vi.resetModules();
  await import('../../src/scripts/entry');
  expect(document.documentElement.hasAttribute('data-intro-pending')).toBe(false);
});

it('plays the home page intro once the page loads', async () => {
  document.body.innerHTML =
    '<div class="neofetch" data-intro><p class="slogan" data-slogan><span class="slogan-text">Hi</span><span class="cursor" aria-hidden="true">▋</span></p></div>';
  sessionStorage.clear();
  vi.resetModules();
  await import('../../src/scripts/entry');
  await vi.waitFor(() => expect(document.querySelector('.typed')).not.toBeNull());
  await vi.waitFor(() => expect(document.querySelector('.typed')).toBeNull());
  expect(sessionStorage.getItem(INTRO_KEY)).toBe('1');
});
