import { GRID_24, horseSvg, PALETTES } from '../../brand/horse';
import { OG_SIZE, type OgTarget } from '../lib/og';

/** The night theme's token values; tokens.css is the source and tests compare against it. */
export const NIGHT = {
  bg: '#1a1b26',
  bar: '#16161e',
  border: '#292e42',
  fg: '#c0caf5',
  muted: '#8089b3',
  accent: '#7aa2f7',
  accent2: '#bb9af7',
  prompt: '#9ece6a',
  user: '#7dcfff',
  dots: ['#f7768e', '#e0af68', '#9ece6a'],
} as const;

export interface OgElement {
  type: string;
  props: Record<string, unknown>;
}

type Child = OgElement | string;

// Satori wants no children key on leaves and a flex display on any div with element children.
const el = (type: string, props: Record<string, unknown>, ...children: Child[]): OgElement => ({
  type,
  props: {
    ...props,
    ...(children.length > 0 ? { children: children.length === 1 ? children[0] : children } : {}),
  },
});

const FONT = '"JetBrains Mono", "Noto Sans SC"';
const HORSE = `data:image/svg+xml;base64,${Buffer.from(horseSvg(GRID_24, PALETTES.night)).toString('base64')}`;

const dot = (color: string) =>
  el('div', { style: { width: 14, height: 14, borderRadius: 7, backgroundColor: color } });

const prompt = el(
  'svg',
  { width: 20, height: 34, viewBox: '0 0 12 20' },
  el('path', {
    d: 'M3 4.5l6.5 5.5-6.5 5.5',
    fill: 'none',
    stroke: NIGHT.prompt,
    strokeWidth: 3,
  }),
);

export function ogTree(target: Pick<OgTarget, 'title' | 'command' | 'path' | 'meta'>): OgElement {
  return el(
    'div',
    {
      style: {
        display: 'flex',
        width: OG_SIZE.width,
        height: OG_SIZE.height,
        padding: 40,
        backgroundColor: NIGHT.bg,
        color: NIGHT.fg,
        fontFamily: FONT,
        fontWeight: 700,
      },
    },
    el(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          border: `2px solid ${NIGHT.border}`,
          borderRadius: 18,
          overflow: 'hidden',
        },
      },
      el(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            height: 58,
            padding: '0 24px',
            backgroundColor: NIGHT.bar,
            borderBottom: `2px solid ${NIGHT.border}`,
            color: NIGHT.muted,
            fontSize: 22,
          },
        },
        ...NIGHT.dots.map(dot),
        el('div', { style: { marginLeft: 14 } }, target.path),
      ),
      el(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            padding: '36px 48px 40px',
            position: 'relative',
          },
        },
        el(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 14, fontSize: 28 } },
          el('span', { style: { color: NIGHT.user } }, 'lilhorse'),
          el('span', { style: { color: NIGHT.muted } }, 'in'),
          el('span', { style: { color: NIGHT.accent } }, '~/lil.horse'),
          prompt,
          el('span', {}, target.command),
        ),
        el(
          'div',
          {
            style: {
              display: 'block',
              marginTop: 30,
              maxWidth: 840,
              fontSize: 60,
              lineHeight: 1.2,
              lineClamp: 3,
            },
          },
          target.title,
        ),
        el(
          'div',
          {
            style: {
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              gap: 20,
              marginTop: 'auto',
              maxWidth: 840,
              color: NIGHT.muted,
              fontSize: 24,
            },
          },
          ...target.meta.map((item) => el('span', {}, item)),
        ),
        el(
          'div',
          {
            style: {
              position: 'absolute',
              right: 44,
              bottom: 36,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 12,
            },
          },
          el('img', { src: HORSE, width: 192, height: 192 }),
          el('span', { style: { color: NIGHT.accent2, fontSize: 22 } }, 'lil.horse'),
        ),
      ),
    ),
  );
}
