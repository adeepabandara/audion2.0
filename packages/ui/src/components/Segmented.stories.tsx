import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Segmented } from './Segmented';

const meta = { title: 'Components/Segmented', component: Segmented } satisfies Meta<
  typeof Segmented
>;
export default meta;
type Story = StoryObj;

export const SpeakMode: Story = {
  render: () => {
    const [v, setV] = useState('auto');
    return (
      <Segmented
        label="When to speak"
        value={v}
        onValueChange={setV}
        options={[
          { value: 'auto', label: 'Auto-speak', icon: 'wave' },
          { value: 'confirm', label: 'Confirm first', icon: 'check' },
        ]}
      />
    );
  },
};
