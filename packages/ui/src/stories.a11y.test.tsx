/// <reference types="vite/client" />
import { composeStories } from '@storybook/react';
import { cleanup, render } from '@testing-library/react';
import axe from 'axe-core';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeRoot, type Theme } from './theme';

const modules = import.meta.glob('./**/*.stories.tsx', { eager: true }) as Record<string, never>;

afterEach(cleanup);

// jsdom has no layout, so colour contrast is covered by contrast.test.ts (token maths) and the Storybook a11y addon.
const RULES = { 'color-contrast': { enabled: false }, region: { enabled: false } };

describe.each(['dark', 'light'] as Theme[])('every story passes axe in the %s theme', (theme) => {
  for (const [file, mod] of Object.entries(modules)) {
    const stories = composeStories(mod);
    for (const [name, Story] of Object.entries(stories)) {
      it(`${file.replace('./', '').replace('.stories.tsx', '')} / ${name}`, async () => {
        render(
          <ThemeRoot theme={theme}>
            {(() => {
              const C = Story as unknown as ComponentType;
              return <C />;
            })()}
          </ThemeRoot>,
        );
        await new Promise((r) => setTimeout(r, 0));
        const results = await axe.run(document.body, { rules: RULES });
        const summary = results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 80)).join(' | ')}`,
        );
        expect(summary).toEqual([]);
      });
    }
  }
});
