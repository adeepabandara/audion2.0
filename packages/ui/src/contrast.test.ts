// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./styles/tokens.css', import.meta.url), 'utf8');

function parseVars(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/(--au-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
  );
}
function blockAfter(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `selector ${selector}`).toBeGreaterThan(-1);
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
}

const light = parseVars(blockAfter('.au-root {'));
const dark = parseVars(blockAfter(".au-root[data-theme='dark']"));
const media = parseVars(blockAfter(":not([data-theme='dark'])"));

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground, background, minimum ratio]. 4.5 = normal text, 3 = UI components / large text.
const PAIRS: Array<[string, string, number]> = [
  ...['--au-bg', '--au-surface', '--au-raised'].flatMap(
    (bg): Array<[string, string, number]> => [
      ['--au-text', bg, 4.5],
      ['--au-text-2', bg, 4.5],
      ['--au-highlight', bg, 4.5],
      // the meeting-context indicator's text gradient (blue, purple, red)
      ['--au-gemini-1', bg, 4.5],
      ['--au-gemini-2', bg, 4.5],
      ['--au-gemini-3', bg, 4.5],
      ['--au-success', bg, 4.5],
      ['--au-warning', bg, 4.5],
      ['--au-error', bg, 4.5],
      ['--au-border', bg, 3],
      ['--au-focus', bg, 3],
    ],
  ),
  ['--au-on-primary', '--au-primary', 4.5],
  ['--au-on-danger', '--au-danger', 4.5],
];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme contrast (WCAG AA)', (_name, vars) => {
  it.each(PAIRS)('%s on %s >= %s:1', (fg, bg, min) => {
    const r = ratio(vars[fg]!, vars[bg]!);
    expect(r, `${fg} ${vars[fg]} on ${bg} ${vars[bg]} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(
      min,
    );
  });
});

describe('token consistency', () => {
  it('system-dark media block equals the explicit dark block', () => {
    expect(media).toEqual(dark);
  });
  it('light and dark define the same tokens', () => {
    const colourKeys = (v: Record<string, string>) =>
      Object.keys(v)
        .filter((k) => /#|rgb/.test(v[k]!))
        .sort();
    expect(colourKeys(dark)).toEqual(colourKeys(light).filter((k) => k in dark));
  });
  it('primary is #0F766E and dark highlight is #2DD4BF', () => {
    expect(light['--au-primary']).toBe('#0f766e');
    expect(dark['--au-highlight']).toBe('#2dd4bf');
  });
});
