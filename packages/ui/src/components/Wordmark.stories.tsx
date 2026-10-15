import type { Meta, StoryObj } from '@storybook/react';
import { Wordmark } from './Wordmark';

const meta = { title: 'Components/Wordmark', component: Wordmark } satisfies Meta<typeof Wordmark>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Full: Story = {};
export const MarkOnly: Story = { args: { markOnly: true } };
export const Animated: Story = { args: { animate: true, size: 120 } };
