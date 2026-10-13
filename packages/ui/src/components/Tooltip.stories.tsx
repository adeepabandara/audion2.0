import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';
import { Tooltip } from './Tooltip';

const meta: Meta = { title: 'Components/Tooltip', component: Tooltip as never };
export default meta;
type Story = StoryObj;

export const OnIconButton: Story = {
  render: () => (
    <div style={{ paddingTop: 48 }}>
      <Tooltip content="Open settings" defaultOpen>
        <Button variant="secondary" icon="gear" iconOnly>
          Settings
        </Button>
      </Tooltip>
    </div>
  ),
};
