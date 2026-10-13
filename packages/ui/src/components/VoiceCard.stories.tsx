import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { VoiceCard } from './VoiceCard';

const meta = { title: 'Components/VoiceCard', component: VoiceCard } satisfies Meta<
  typeof VoiceCard
>;
export default meta;
type Story = StoryObj;

export const Group: Story = {
  render: () => {
    const [sel, setSel] = useState('aria');
    const voices = [
      ['aria', 'Aria', 'Warm, female, US English'],
      ['nora', 'Nora', 'Bright, female, US English'],
      ['david', 'David', 'Calm, male, US English'],
      ['miles', 'Miles', 'Deep, male, US English'],
    ] as const;
    return (
      <div role="radiogroup" aria-label="Voice" style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
        {voices.map(([id, name, d]) => (
          <VoiceCard
            key={id}
            groupName="voice"
            name={name}
            description={d}
            selected={sel === id}
            onSelect={() => setSel(id)}
          />
        ))}
      </div>
    );
  },
};
export const Playing: Story = {
  args: {
    name: 'Aria',
    description: 'Warm, female, US English',
    groupName: 'v',
    selected: true,
    playing: true,
  },
};
