import type { Availability, ProfileEntry } from '../notion/types';
import { escapeAttr } from './html';
import { socialLinks } from './profile';

const STATUS: Record<Availability, string> = {
  'Open to work': '🟢 Open to work',
  Freelancing: '🟡 Freelancing',
  Busy: '🔴 Busy',
};
const SWATCHES = '🟥🟧🟨🟩🟦🟪';

/** Backslash-escapes what Markdown or HTML would read as markup; `#` only where it would start a heading. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\*_`[\]<>|~]/g, '\\$&').replace(/^( {0,3})#/gm, '$1\\#');
}

/** A code span fenced with more backticks than any run inside it. */
export function inlineCode(text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), ([run]) => run.length));
  const fence = '`'.repeat(longest + 1);
  // Markdown drops one space at each end, so this keeps a backtick at the edge apart from the fence.
  const pad = /^`|`$/.test(text) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

// A line break in a Notion field could start a new Markdown block.
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const field = (text: string) => escapeMarkdown(oneLine(text));
const italic = (text: string | null) => (text && oneLine(text) ? [`*${field(text)}*`] : []);

/** Percent-encodes what would end a Markdown link destination early. */
const destination = (url: string) =>
  url.replace(
    /[\s()<>\\]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );

export interface ProfileReadmeInput {
  title: string;
  /** The title in half blocks; empty when the banner font can draw none of it. */
  banner: string[];
  slogan: string | null;
  profile: ProfileEntry;
  site: string;
}

/** The home page's neofetch card as a GitHub profile README. It never holds the email address. */
export function profileReadme({
  title,
  banner,
  slogan,
  profile,
  site,
}: ProfileReadmeInput): string {
  const base = site.replace(/\/+$/, '');
  const horse = `<a href="${escapeAttr(base)}"><picture><source media="(prefers-color-scheme: dark)" srcset="${escapeAttr(base)}/brand/horse-night.svg"><img align="left" width="120" alt="" src="${escapeAttr(base)}/brand/horse-chestnut.svg"></picture></a>`;
  const contact = [
    `[${escapeMarkdown(new URL(base).host)}](${destination(base)})`,
    ...(profile.email ? [`[email](${destination(`${base}/contact`)})`] : []),
    ...socialLinks(profile).map((link) => `[${link.label}](${destination(link.href)})`),
  ];
  const stack = profile.stack.map((item) => inlineCode(oneLine(item)));
  const info = [
    `**Role** · ${field(profile.role)}`,
    `**Location** · ${field(profile.location)}`,
    ...(stack.length > 0 ? [`**Stack** · ${stack.join(' · ')}`] : []),
    `**Status** · ${STATUS[profile.availability]}`,
    `**Contact** · ${contact.join(' · ')}`,
  ];
  const blocks = [
    horse,
    banner.length > 0 ? ['```text', ...banner, '```'].join('\n') : `**${field(title)}**`,
    ...italic(slogan),
    info.map((row) => `${row}<br>`).join('\n'),
    SWATCHES,
    ...italic(profile.bio),
  ];
  return `${blocks.join('\n\n')}\n`;
}
