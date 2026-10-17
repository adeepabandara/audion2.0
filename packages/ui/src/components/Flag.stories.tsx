import type { Meta, StoryObj } from '@storybook/react';
import { Flag, type FlagCode } from './Flag';

const meta = { title: 'Components/Flag', component: Flag } satisfies Meta<typeof Flag>;
export default meta;
type Story = StoryObj;

const CODES: FlagCode[] = ['en', 'es', 'fr', 'de', 'pt', 'hi', 'ja', 'zh', 'ar'];

export const All: Story = {
  render: () => (
    <ul style={{ display: 'flex', gap: 12, listStyle: 'none', padding: 0 }}>
      {CODES.map((c) => (
        <li key={c} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Flag code={c} size={28} /> {c}
        </li>
      ))}
    </ul>
  ),
};
