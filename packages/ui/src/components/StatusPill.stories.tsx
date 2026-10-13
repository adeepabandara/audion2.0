import type { Meta, StoryObj } from '@storybook/react';
import { STATUS_META, StatusPill, type Status } from './StatusPill';

const meta = {
  title: 'Components/StatusPill',
  component: StatusPill,
  args: { status: 'ready' },
} satisfies Meta<typeof StatusPill>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const SeeingYou: Story = { args: { status: 'seeing' } };
export const All: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {(Object.keys(STATUS_META) as Status[]).map((s) => (
        <StatusPill key={s} status={s} />
      ))}
    </div>
  ),
};
