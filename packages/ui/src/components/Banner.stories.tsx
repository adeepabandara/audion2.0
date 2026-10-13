import type { Meta, StoryObj } from '@storybook/react';
import { Banner } from './Banner';
import { Button } from './Button';

const meta = { title: 'Components/Banner', component: Banner } satisfies Meta<typeof Banner>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = {
  args: { tone: 'info', children: 'Reload this Meet tab once so Audion can speak in the call.' },
};
export const Warning: Story = {
  args: { tone: 'warning', title: 'Poor lighting. ', children: 'Move to a brighter spot.' },
};
export const ErrorWithAction: Story = {
  args: {
    tone: 'error',
    title: 'Camera blocked. ',
    children: 'Allow camera access to use Audion.',
    action: <Button variant="secondary">Fix permissions</Button>,
  },
};
