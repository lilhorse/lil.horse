import type { Availability, ProfileEntry } from '../notion/types';
import { bannerImageSize, bannerLabel, type Bitmap } from './banner';
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
  /** The banner's bitmap size; zero wide when the banner font can draw none of the title. */
  banner: Pick<Bitmap, 'width' | 'height'>;
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
  const host = new URL(base).host;
  const href = escapeAttr(base);
  // GitHub links every image whose parent is not a link, which would split a <picture> nested in one.
  const picture = (dark: string, image: string) =>
    `<picture><source media="(prefers-color-scheme: dark)" srcset="${href}/brand/${dark}"><a href="${href}">${image}</a></picture>`;
  const horse = picture(
    'horse-night.svg',
    `<img align="left" width="120" alt="${escapeAttr(host)}" src="${href}/brand/horse-chestnut.svg">`,
  );
  const masthead =
    banner.width > 0
      ? picture(
          'masthead-dark.svg',
          `<img alt="${escapeAttr(bannerLabel(title))}" width="${bannerImageSize(banner).width}" src="${href}/brand/masthead-light.svg">`,
        )
      : `**${field(title)}**`;
  const contact = [
    `[${escapeMarkdown(host)}](${destination(base)})`,
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
    masthead,
    ...italic(slogan),
    info.map((row) => `${row}<br>`).join('\n'),
    SWATCHES,
    ...italic(profile.bio),
  ];
  return `${blocks.join('\n\n')}\n`;
}
