import type { PageObjectResponse } from '@notionhq/client';
import { normalizeId, notionUrl } from './ids';
import {
  coverUrl,
  PropertyError,
  readCheckbox,
  readDate,
  readEmail,
  readNumber,
  readOption,
  readOptions,
  readText,
  readTitle,
  readUrl,
} from './properties';
import type { Availability, Language, PostStatus, ProfileEntry, ProjectStatus } from './types';

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const POST_STATUSES: readonly PostStatus[] = ['Draft', 'Published', 'Unlisted'];
const LANGUAGES: readonly Language[] = ['en', 'zh'];
const PROJECT_STATUSES: readonly ProjectStatus[] = ['Active', 'Maintained', 'Archived'];
const AVAILABILITIES: readonly Availability[] = ['Open to work', 'Freelancing', 'Busy'];
const NO_PAGE = '0'.repeat(32);

export type CollectionName = 'posts' | 'projects' | 'profile';

export interface ValidationIssue {
  collection: CollectionName;
  pageId: string;
  title: string;
  field: string;
  message: string;
}

export function formatIssue(issue: ValidationIssue): string {
  return `- [${issue.collection}] "${issue.title || '(untitled)'}" (${notionUrl(issue.pageId)}) ${issue.field}: ${issue.message}`;
}

export class ContentValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(`Notion content failed validation:\n${issues.map(formatIssue).join('\n')}`);
    this.name = 'ContentValidationError';
    this.issues = issues;
  }
}

export interface ParseResult<T> {
  items: T[];
  issues: ValidationIssue[];
  warnings: string[];
}

export interface ParsedPost {
  id: string;
  title: string;
  slug: string;
  status: PostStatus;
  published: string;
  updated: string | null;
  tags: string[];
  description: string | null;
  language: Language;
  featured: boolean;
  coverUrl: string | null;
  lastEditedTime: string;
}

export interface ParsedProject {
  id: string;
  name: string;
  slug: string | null;
  description: string;
  stack: string[];
  link: string | null;
  repo: string | null;
  status: ProjectStatus | null;
  featured: boolean;
  order: number | null;
  year: number | null;
  coverUrl: string | null;
  lastEditedTime: string;
}

function isOneOf<T extends string>(value: string, options: readonly T[]): value is T {
  return (options as readonly string[]).includes(value);
}

// `https:example.com` parses on its own but resolves against the page URL inside an href.
function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) && URL.canParse(value);
}

type ReportIssue = (field: string, message: string) => void;

function rowContext(collection: CollectionName, row: PageObjectResponse) {
  const pageId = normalizeId(row.id);
  const title = readTitle(row.properties);
  const issues: ValidationIssue[] = [];
  const issue: ReportIssue = (field, message) => {
    issues.push({ collection, pageId, title, field, message });
  };
  const read = <T>(field: string, reader: () => T, fallback: T): T => {
    try {
      return reader();
    } catch (error) {
      if (!(error instanceof PropertyError)) throw error;
      issue(field, error.message);
      return fallback;
    }
  };
  return { pageId, title, issues, issue, read };
}

function claimSlug(
  usedSlugs: Map<string, string>,
  slug: string | null,
  pageId: string,
  issue: ReportIssue,
): void {
  if (!slug || !SLUG_PATTERN.test(slug)) return;
  const owner = usedSlugs.get(slug);
  if (owner) issue('Slug', `"${slug}" is already used by ${notionUrl(owner)}`);
  else usedSlugs.set(slug, pageId);
}

export function parsePosts(rows: PageObjectResponse[]): ParseResult<ParsedPost> {
  const result: ParseResult<ParsedPost> = { items: [], issues: [], warnings: [] };
  const usedSlugs = new Map<string, string>();
  const drafts: { post: ParsedPost; issues: ValidationIssue[]; issue: ReportIssue }[] = [];

  for (const row of rows) {
    const { pageId, title, issues, issue, read } = rowContext('posts', row);
    const props = row.properties;
    if (props.Status === undefined) issue('Status', 'column is missing');
    const status = read('Status', () => readOption(props, 'Status'), null);
    if (issues.length > 0) {
      result.issues.push(...issues);
      continue;
    }
    // A freshly created page has no Status yet; failing the production build on it would block every deploy.
    const statusName = status ?? 'Draft';
    if (!isOneOf(statusName, POST_STATUSES)) {
      issue('Status', `must be one of ${POST_STATUSES.join(', ')} (found ${statusName})`);
      result.issues.push(...issues);
      continue;
    }
    const slug = read('Slug', () => readText(props, 'Slug'), null);
    const published = read('Published', () => readDate(props, 'Published'), null);
    const language = read('Language', () => readOption(props, 'Language'), null) ?? 'en';
    if (!title) issue('Name', 'is required');
    if (!slug) issue('Slug', 'is required');
    else if (!SLUG_PATTERN.test(slug)) issue('Slug', `"${slug}" must match ${SLUG_PATTERN}`);
    if (statusName !== 'Draft' && !published)
      issue('Published', 'is required for published and unlisted posts');
    if (!isOneOf(language, LANGUAGES)) issue('Language', `must be en or zh (found ${language})`);

    const parsed: ParsedPost = {
      id: pageId,
      title,
      slug: slug ?? '',
      status: statusName,
      published: published?.start ?? row.created_time.slice(0, 10),
      updated: read('Updated', () => readDate(props, 'Updated')?.start ?? null, null),
      tags: read('Tags', () => readOptions(props, 'Tags'), []),
      description: read('Description', () => readText(props, 'Description'), null),
      language: isOneOf(language, LANGUAGES) ? language : 'en',
      featured: read('Featured', () => readCheckbox(props, 'Featured'), false),
      coverUrl: coverUrl(row),
      lastEditedTime: row.last_edited_time,
    };

    if (statusName === 'Draft') {
      drafts.push({ post: parsed, issues, issue });
      continue;
    }
    claimSlug(usedSlugs, slug, pageId, issue);
    if (issues.length > 0) {
      result.issues.push(...issues);
      continue;
    }
    result.items.push(parsed);
  }

  for (const { post, issues, issue } of drafts) {
    claimSlug(usedSlugs, post.slug, post.id, issue);
    if (issues.length > 0) {
      const problems = issues.map((i) => `${i.field} ${i.message}`).join('; ');
      result.warnings.push(
        `Draft "${post.title || '(untitled)'}" (${notionUrl(post.id)}) skipped: ${problems}`,
      );
      continue;
    }
    result.items.push(post);
  }
  return result;
}

export function parseProjects(rows: PageObjectResponse[]): ParseResult<ParsedProject> {
  const result: ParseResult<ParsedProject> = { items: [], issues: [], warnings: [] };
  const usedSlugs = new Map<string, string>();
  for (const row of rows) {
    const { pageId, title, issues, issue, read } = rowContext('projects', row);
    const props = row.properties;
    if (props.Visible === undefined) issue('Visible', 'column is missing');
    if (!read('Visible', () => readCheckbox(props, 'Visible'), false)) {
      result.issues.push(...issues);
      continue;
    }
    const slug = read('Slug', () => readText(props, 'Slug'), null);
    const description = read('Description', () => readText(props, 'Description'), null);
    const status = read('Status', () => readOption(props, 'Status'), null);
    const link = read('Link', () => readUrl(props, 'Link')?.trim() || null, null);
    const repo = read('Repo', () => readUrl(props, 'Repo')?.trim() || null, null);
    if (!title) issue('Name', 'is required');
    if (!description) issue('Description', 'is required for visible projects');
    if (slug && !SLUG_PATTERN.test(slug)) issue('Slug', `"${slug}" must match ${SLUG_PATTERN}`);
    claimSlug(usedSlugs, slug, pageId, issue);
    if (status !== null && !isOneOf(status, PROJECT_STATUSES))
      issue('Status', `must be one of ${PROJECT_STATUSES.join(', ')} (found ${status})`);
    if (link && !isHttpUrl(link))
      issue('Link', `must be an http(s) URL (found ${JSON.stringify(link)})`);
    if (repo && !isHttpUrl(repo))
      issue('Repo', `must be an http(s) URL (found ${JSON.stringify(repo)})`);
    const project: ParsedProject = {
      id: pageId,
      name: title,
      slug,
      description: description ?? '',
      stack: read('Stack', () => readOptions(props, 'Stack'), []),
      link,
      repo,
      status: status !== null && isOneOf(status, PROJECT_STATUSES) ? status : null,
      featured: read('Featured', () => readCheckbox(props, 'Featured'), false),
      order: read('Order', () => readNumber(props, 'Order'), null),
      year: read('Year', () => readNumber(props, 'Year'), null),
      coverUrl: coverUrl(row),
      lastEditedTime: row.last_edited_time,
    };
    if (issues.length > 0) {
      result.issues.push(...issues);
      continue;
    }
    result.items.push(project);
  }
  return result;
}

export function parseProfile(rows: PageObjectResponse[]): ParseResult<ProfileEntry> {
  if (rows.length !== 1) {
    return {
      items: [],
      warnings: [],
      issues: [
        {
          collection: 'profile',
          pageId: rows[0] ? normalizeId(rows[0].id) : NO_PAGE,
          title: 'Profile',
          field: '(database)',
          message: `must contain exactly one row (found ${rows.length})`,
        },
      ],
    };
  }
  const row = rows[0] as PageObjectResponse;
  const { pageId, title, issues, issue, read } = rowContext('profile', row);
  const props = row.properties;
  const role = read('Role', () => readText(props, 'Role'), null);
  const location = read('Location', () => readText(props, 'Location'), null);
  const availability = read('Availability', () => readOption(props, 'Availability'), null);
  if (!title) issue('Name', 'is required');
  if (!role) issue('Role', 'is required');
  if (!location) issue('Location', 'is required');
  if (availability === null || !isOneOf(availability, AVAILABILITIES)) {
    issue(
      'Availability',
      `must be one of ${AVAILABILITIES.join(', ')} (found ${availability ?? 'empty'})`,
    );
  }
  const entry: ProfileEntry = {
    id: pageId,
    name: title,
    role: role ?? '',
    location: location ?? '',
    availability:
      availability !== null && isOneOf(availability, AVAILABILITIES) ? availability : 'Busy',
    stack: read('Stack', () => readOptions(props, 'Stack'), []),
    email: read('Email', () => readEmail(props, 'Email'), null),
    github: read('GitHub', () => readText(props, 'GitHub'), null),
    x: read('X', () => readText(props, 'X'), null),
    bio: read('Bio', () => readText(props, 'Bio'), null),
  };
  return issues.length > 0
    ? { items: [], issues, warnings: [] }
    : { items: [entry], issues: [], warnings: [] };
}
