import { describe, expect, it } from 'vitest';
import CommandPalette from '../../src/components/shell/CommandPalette.astro';
import { htmlErrors, render, textOf } from '../helpers/astro-render';
import { element, post, profile } from '../helpers/site-data';

describe('CommandPalette', () => {
  it('lists navigation, recent posts and actions, and never the whole email address', async () => {
    const html = await render(CommandPalette, {
      posts: [
        post('new', { published: '2024-03-01' }),
        post('zh', { published: '2024-02-01', language: 'zh', title: '我的豆瓣备份' }),
        post('old', { published: '2024-01-01' }),
        post('hidden', { status: 'Unlisted', published: '2024-04-01' }),
      ],
      profile: { ...profile, email: 'sup@lil.horse' },
    });
    expect(html).toContain(
      '<dialog class="palette" data-palette data-email-user="sup" data-email-host="lil.horse" aria-label="Command palette">',
    );
    expect(html).not.toContain('sup@lil.horse');
    expect(html).toContain(
      '<input id="palette-query" type="text" role="combobox" aria-expanded="true" aria-controls="palette-options" aria-autocomplete="list"',
    );
    expect(textOf(element(html, '<ul role="group" aria-label="Go to"', 'ul'))).toBe(
      '~ home ▸ blog ▸ projects ▸ about ▸ contact',
    );
    expect(textOf(element(html, '<ul role="group" aria-label="Recent posts"', 'ul'))).toBe(
      '▸ Post new 2024-03-01 ▸ 我的豆瓣备份 2024-02-01 ▸ Post old 2024-01-01',
    );
    expect(html).toContain('<span class="label" lang="zh-Hans">我的豆瓣备份</span>');
    expect(html).toContain('id="palette-post-new" data-href="/blog/new"');
    for (const action of ['theme', 'copy-email', 'email'])
      expect(html).toContain(`data-action="${action}"`);
    expect(html).toContain('id="palette-rss" data-href="/feed.xml"');
    expect(html).toContain('<button type="button" data-theme-set="system" aria-pressed="true">');
    expect(html).toContain('<button type="button" data-theme-set="dark" aria-pressed="false">');
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('drops the email actions without an address and the recent group without posts', async () => {
    const html = await render(CommandPalette, { posts: [], profile });
    expect(html).toContain('<dialog class="palette" data-palette aria-label="Command palette">');
    expect(html).not.toContain('data-action="copy-email"');
    expect(html).not.toContain('data-action="email"');
    expect(html).toContain('<li class="group" role="presentation" data-group="recent" hidden>');
  });
});
