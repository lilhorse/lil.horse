export const SHELL = {
  user: 'lilhorse',
  host: 'lil.horse',
  cwd: '~/lil.horse',
  branch: 'main',
} as const;

export type Section = 'home' | 'blog' | 'projects' | 'about' | 'contact';
