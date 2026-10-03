import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

export interface OgFont {
  name: string;
  data: Buffer;
  weight: 700;
  style: 'normal';
}

const FILES: [string, string][] = [
  ['JetBrains Mono', '@expo-google-fonts/jetbrains-mono/700Bold/JetBrainsMono_700Bold.ttf'],
  ['Noto Sans SC', '@expo-google-fonts/noto-sans-sc/700Bold/NotoSansSC_700Bold.ttf'],
];

const require = createRequire(import.meta.url);
let fonts: Promise<OgFont[]> | undefined;

/** Read once per build: Satori caches its parsing per Buffer, so every image shares these objects. */
export function loadFonts(): Promise<OgFont[]> {
  fonts ??= Promise.all(
    FILES.map(async ([name, file]) => ({
      name,
      data: await readFile(require.resolve(file)),
      weight: 700 as const,
      style: 'normal' as const,
    })),
  );
  return fonts;
}
