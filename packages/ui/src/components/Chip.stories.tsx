import type { Meta, StoryObj } from '@storybook/react';
import { Chip } from './Chip';

const meta = {
  title: 'Components/Chip',
  component: Chip,
  args: { children: 'tomorrow' },
} satisfies Meta<typeof Chip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Normal: Story = {};
export const LowConfidence: Story = { args: { state: 'lowConfidence' } };
export const Confirmed: Story = { args: { state: 'confirmed', children: 'hello' } };
export const SentenceRow: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Chip state="confirmed">hello</Chip>→<Chip state="confirmed">please</Chip>→
      <Chip state="lowConfidence">wait</Chip>
    </div>
  ),
};
