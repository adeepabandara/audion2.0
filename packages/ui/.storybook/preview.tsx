import type { Preview } from '@storybook/react';
import { ThemeRoot, type Theme } from '../src';
import '../src/styles/index.css';

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Audion theme',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'dark', title: 'Dark' },
          { value: 'light', title: 'Light' },
          { value: 'system', title: 'System' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'dark' },
  decorators: [
    (Story, ctx) => {
      const theme = (ctx.globals.theme ?? 'dark') as Theme;
      document.body.style.background = theme === 'light' ? '#fff' : '#0f1115';
      return (
        <ThemeRoot theme={theme} style={{ padding: 24, minHeight: 200 }}>
          <Story />
        </ThemeRoot>
      );
    },
  ],
  parameters: { layout: 'fullscreen', a11y: { test: 'error' } },
};
export default preview;
