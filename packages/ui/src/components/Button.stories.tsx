import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';

const meta = {
  title: 'Components/Button',
  component: Button,
  args: { children: 'Speak' },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: 'primary', icon: 'wave' } };
export const Secondary: Story = { args: { variant: 'secondary', children: 'Cancel' } };
export const Ghost: Story = { args: { variant: 'ghost', children: 'Report a problem' } };
export const Danger: Story = {
  args: { variant: 'danger', children: 'Turn Ola off', icon: 'x' },
};
export const Disabled: Story = { args: { disabled: true } };
export const IconOnly: Story = {
  args: { variant: 'secondary', icon: 'gear', iconOnly: true, children: 'Settings' },
};
