import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentManifest } from '../notion/loaders';
import { resolves, type DistIssue } from './dist-check';

/** The posts the old site served at the root; new posts never had such an address. */
export const LEGACY_POST_SLUGS = ['helloworld', 'douban'];

export interface Redirect {
  from: string;
  to: string;
  status: number;
}

/** Cloudflare reads these top to bottom, so the exact addresses come before the one trailing-slash rule. */
export function redirectRules(manifest: ContentManifest): string[] {
  const rules: string[] = [];
  for (const post of manifest.posts) {
    const target = `/blog/${post.slug}`;
    if (LEGACY_POST_SLUGS.includes(post.slug)) rules.push(`/${post.slug} ${target} 301`);
    rules.push(`/${post.id} ${target} 301`, `/${post.slug}-${post.id} ${target} 301`);
  }
  rules.push('/feed /feed.xml 301');
  for (const page of manifest.pages)
    rules.push(`/${page.id} /${page.key} 301`, `/${page.key}-${page.id} /${page.key} 301`);
  rules.push('/*/ /:splat 301');
  return rules;
}

export function redirectsFile(manifest: ContentManifest): string {
  return `${redirectRules(manifest).join('\n')}\n`;
}

export function parseRedirects(text: string): Redirect[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [from = '', to = '', status = '302'] = line.split(/\s+/);
      return { from, to, status: Number(status) };
    });
}

/** As Cloudflare reads _redirects: the first matching rule wins, and a `*` source fills `:splat` with `replaceAll`. */
export function matchRedirect(
  rules: Redirect[],
  pathname: string,
): { location: string; status: number } | null {
  for (const rule of rules) {
    if (!rule.from.includes('*')) {
      if (rule.from === pathname) return { location: rule.to, status: rule.status };
      continue;
    }
    const [prefix = '', suffix = ''] = rule.from.split('*');
    if (
      pathname.length >= prefix.length + suffix.length &&
      pathname.startsWith(prefix) &&
      pathname.endsWith(suffix)
    ) {
      const splat = pathname.slice(prefix.length, pathname.length - suffix.length);
      const target = rule.to.replaceAll(':splat', splat);
      // Collapsing slash runs keeps a target without a scheme from turning scheme-relative.
      const location = /^\w+:\/\//.test(target) ? target : target.replace(/\/+/g, '/');
      return { location, status: rule.status };
    }
  }
  return null;
}

/** Every static rule must lead from no page to a page of this build, and the one dynamic rule must come last. */
export async function unresolvedRedirects(dist: string): Promise<DistIssue[]> {
  const file = join(dist, '_redirects');
  if (!existsSync(file)) return [{ file: '_redirects', message: 'is missing' }];
  const rules = parseRedirects(readFileSync(file, 'utf8'));
  const issues: DistIssue[] = [];
  rules.forEach((rule, index) => {
    if (rule.status !== 301)
      issues.push({
        file: '_redirects',
        message: `${rule.from} redirects with ${rule.status}, not 301`,
      });
    if (rule.from.includes('*')) {
      if (index !== rules.length - 1)
        issues.push({ file: '_redirects', message: `${rule.from} must be the last rule` });
      return;
    }
    // Cloudflare applies redirects before it serves files.
    if (resolves(dist, rule.from))
      issues.push({ file: '_redirects', message: `${rule.from} hides a page of this build` });
    if (!resolves(dist, rule.to))
      issues.push({ file: '_redirects', message: `${rule.from} redirects to missing ${rule.to}` });
  });
  return issues;
}
