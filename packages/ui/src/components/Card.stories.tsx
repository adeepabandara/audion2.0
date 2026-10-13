import type { Meta, StoryObj } from '@storybook/react';
import { Card } from './Card';

const meta = { title: 'Components/Card', component: Card } satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { title: 'Your voice', children: 'Pick the voice people hear when you sign.' },
};
export const Raised: Story = {
  args: { title: 'Last sentence', raised: true, children: 'Please wait, I’ll talk tomorrow.' },
};
