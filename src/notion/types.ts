export type NotionColor =
  | 'default'
  | 'gray'
  | 'brown'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red'
  | 'default_background'
  | 'gray_background'
  | 'brown_background'
  | 'orange_background'
  | 'yellow_background'
  | 'green_background'
  | 'blue_background'
  | 'purple_background'
  | 'pink_background'
  | 'red_background';

export interface Annotations {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  underline: boolean;
  code: boolean;
  color: NotionColor;
}

export type RichTextSpan =
  | {
      kind: 'text';
      text: string;
      annotations: Annotations;
      href: string | null;
      pageId: string | null;
    }
  | { kind: 'equation'; expression: string; annotations: Annotations }
  | { kind: 'date'; text: string; start: string; end: string | null; annotations: Annotations };

export type RichText = RichTextSpan[];

export interface MediaVariant {
  width: number;
  format: 'avif' | 'webp';
  src: string;
}

export interface MediaRef {
  key: string;
  kind: 'image' | 'file';
  mime: string;
  bytes: number;
  fileName: string;
  src: string;
  width: number | null;
  height: number | null;
  variants: MediaVariant[];
  dominant: string | null;
}

export type Icon = { kind: 'emoji'; emoji: string } | { kind: 'image'; media: MediaRef };

export interface BookmarkMeta {
  title: string | null;
  description: string | null;
  siteName: string | null;
  image: MediaRef | null;
  icon: MediaRef | null;
}

interface BaseNode {
  id: string;
}

export interface ParagraphNode extends BaseNode {
  type: 'paragraph';
  text: RichText;
  color: NotionColor;
  children: Node[];
}

export interface HeadingNode extends BaseNode {
  type: 'heading';
  level: 2 | 3 | 4 | 5;
  text: RichText;
  anchor: string;
  color: NotionColor;
  toggleable: boolean;
  children: Node[];
}

export interface ListItem {
  id: string;
  text: RichText;
  color: NotionColor;
  checked: boolean | null;
  children: Node[];
}

export interface ListNode extends BaseNode {
  type: 'list';
  style: 'bulleted' | 'numbered' | 'todo';
  items: ListItem[];
}

export interface QuoteNode extends BaseNode {
  type: 'quote';
  text: RichText;
  color: NotionColor;
  children: Node[];
}

export interface CalloutNode extends BaseNode {
  type: 'callout';
  icon: Icon | null;
  text: RichText;
  color: NotionColor;
  children: Node[];
}

export interface ToggleNode extends BaseNode {
  type: 'toggle';
  summary: RichText;
  color: NotionColor;
  children: Node[];
}

export interface DividerNode extends BaseNode {
  type: 'divider';
}

export interface CodeNode extends BaseNode {
  type: 'code';
  language: string;
  code: string;
  caption: RichText;
  frame: 'terminal' | 'editor' | 'none';
  title: string | null;
}

export interface EquationNode extends BaseNode {
  type: 'equation';
  expression: string;
}

export interface ImageNode extends BaseNode {
  type: 'image';
  media: MediaRef;
  caption: RichText;
  alt: string;
}

export type VideoSource =
  | { kind: 'youtube'; videoId: string; poster: MediaRef | null }
  | { kind: 'vimeo'; videoId: string; hash: string | null }
  | { kind: 'file'; media: MediaRef }
  | { kind: 'link'; url: string };

export interface VideoNode extends BaseNode {
  type: 'video';
  source: VideoSource;
  caption: RichText;
}

export interface AudioNode extends BaseNode {
  type: 'audio';
  media: MediaRef;
  caption: RichText;
}

export interface FileNode extends BaseNode {
  type: 'file';
  media: MediaRef;
  name: string;
  caption: RichText;
}

export interface BookmarkNode extends BaseNode {
  type: 'bookmark';
  url: string;
  meta: BookmarkMeta | null;
  caption: RichText;
}

export interface TableNode extends BaseNode {
  type: 'table';
  columnHeader: boolean;
  rowHeader: boolean;
  rows: RichText[][];
}

export interface Column {
  id: string;
  widthRatio: number | null;
  children: Node[];
}

export interface ColumnsNode extends BaseNode {
  type: 'columns';
  columns: Column[];
}

export interface DbColumn {
  id: string;
  name: string;
  type: string;
  format: 'stars' | null;
}

export type DbCell =
  | { kind: 'empty' }
  | { kind: 'text'; text: RichText }
  | { kind: 'chips'; values: { name: string; color: NotionColor }[] }
  | { kind: 'date'; start: string; end: string | null }
  | { kind: 'number'; value: number }
  | { kind: 'checkbox'; value: boolean }
  | { kind: 'url'; url: string }
  | { kind: 'media'; items: MediaRef[] }
  | { kind: 'stars'; value: number };

export interface DbRow {
  id: string;
  cells: Record<string, DbCell>;
}

export interface DatabaseNode extends BaseNode {
  type: 'database';
  title: string;
  columns: DbColumn[];
  rows: DbRow[];
}

export interface TocNode extends BaseNode {
  type: 'toc';
}

export interface PageLinkNode extends BaseNode {
  type: 'page_link';
  pageId: string;
  title: string;
}

export interface ContainerNode extends BaseNode {
  type: 'container';
  children: Node[];
}

export interface UnsupportedNode extends BaseNode {
  type: 'unsupported';
  blockType: string;
}

export type Node =
  | ParagraphNode
  | HeadingNode
  | ListNode
  | QuoteNode
  | CalloutNode
  | ToggleNode
  | DividerNode
  | CodeNode
  | EquationNode
  | ImageNode
  | VideoNode
  | AudioNode
  | FileNode
  | BookmarkNode
  | TableNode
  | ColumnsNode
  | DatabaseNode
  | TocNode
  | PageLinkNode
  | ContainerNode
  | UnsupportedNode;

export interface HeadingRef {
  anchor: string;
  text: string;
  level: 2 | 3 | 4 | 5;
}

export interface PageContent {
  blocks: Node[];
  headings: HeadingRef[];
  plainText: string;
  firstParagraph: string | null;
  hasMath: boolean;
  priorityImageId: string | null;
  childDataSourceIds: string[];
  mediaKeys: string[];
  linkedPageIds: string[];
}

export type PostStatus = 'Draft' | 'Published' | 'Unlisted';
export type Language = 'en' | 'zh';
export type ProjectStatus = 'Active' | 'Maintained' | 'Archived';
export type Availability = 'Open to work' | 'Freelancing' | 'Busy';
export type StandalonePageKey = 'about' | 'contact';

export interface PostEntry {
  id: string;
  slug: string;
  title: string;
  status: PostStatus;
  published: string;
  updated: string | null;
  tags: string[];
  description: string;
  language: Language;
  featured: boolean;
  cover: MediaRef | null;
  lastEditedTime: string;
  readingMinutes: number;
  content: PageContent;
}

export interface ProjectEntry {
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
  cover: MediaRef | null;
  lastEditedTime: string;
  content: PageContent | null;
}

export interface ProfileEntry {
  id: string;
  name: string;
  role: string;
  location: string;
  availability: Availability;
  stack: string[];
  email: string | null;
  github: string | null;
  x: string | null;
  bio: string | null;
}

export interface StandalonePageEntry {
  id: string;
  key: StandalonePageKey;
  title: string;
  icon: Icon | null;
  cover: MediaRef | null;
  lastEditedTime: string;
  content: PageContent;
}

export interface SiteContent {
  posts: PostEntry[];
  projects: ProjectEntry[];
  profile: ProfileEntry;
  pages: StandalonePageEntry[];
  mediaKeys: string[];
  warnings: string[];
}

export interface DatabaseDisplay {
  columns: { property: string; format?: 'stars' }[];
  sort?: { property: string; direction: 'ascending' | 'descending' };
}

export interface NotionSiteConfig {
  postsDatabaseId: string;
  projectsDatabaseId: string;
  profileDatabaseId: string;
  pages: Record<StandalonePageKey, string>;
  databaseDisplay: Record<string, DatabaseDisplay>;
}
