import type { Meta, StoryObj } from '@storybook/react';
import { Tabs } from './Tabs';

const meta = { title: 'Components/Tabs', component: Tabs } satisfies Meta<typeof Tabs>;
export default meta;
type Story = StoryObj;

export const Settings: Story = {
  render: () => (
    <Tabs
      label="Settings sections"
      tabs={[
        { id: 'voice', label: 'Voice', panel: <p>Voice and language choices.</p> },
        { id: 'signing', label: 'Signing', panel: <p>Pause and recognition choices.</p> },
        { id: 'about', label: 'About', panel: <p>Privacy and credits.</p> },
      ]}
    />
  ),
};
