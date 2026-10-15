import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { expect, userEvent, within } from '@storybook/test';
import { Toggle } from './Toggle';

const meta = {
  title: 'Components/Toggle',
  component: Toggle,
  args: { label: 'Ola', checked: false },
} satisfies Meta<typeof Toggle>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {
  render: (args) => {
    const [on, setOn] = useState(args.checked);
    return <Toggle {...args} checked={on} onCheckedChange={setOn} />;
  },
  play: async ({ canvasElement }) => {
    const sw = within(canvasElement).getByRole('switch', { name: 'Ola' });
    await userEvent.click(sw);
    await expect(sw).toBeChecked();
  },
};
export const On: Story = { args: { checked: true } };
export const LockedOn: Story = {
  args: { checked: true, disabled: true, label: "Don't store any video" },
};
