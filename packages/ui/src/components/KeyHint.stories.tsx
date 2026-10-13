import type { Meta, StoryObj } from '@storybook/react';
import { KeyHint } from './KeyHint';

const meta = { title: 'Components/KeyHint', component: KeyHint } satisfies Meta<typeof KeyHint>;
export default meta;
export const Enter: StoryObj<typeof meta> = { args: { children: 'Enter' } };
