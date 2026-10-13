import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Button } from './Button';
import { Chip } from './Chip';
import { KeyHint } from './KeyHint';
import { Popover, PopoverActions } from './Popover';

const meta: Meta = { title: 'Components/Popover', component: Popover as never };
export default meta;
type Story = StoryObj;

export const ConfirmSign: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    return (
      <div style={{ minHeight: 200 }}>
        <Popover
          open={open}
          onOpenChange={setOpen}
          title="Did you mean “tomorrow”?"
          anchor={
            <div style={{ display: 'flex', gap: 8 }}>
              <Chip state="confirmed">hello</Chip>
              <Chip state="lowConfidence">tomorrow</Chip>
            </div>
          }
        >
          <PopoverActions>
            <Button onClick={() => setOpen(false)}>
              Yes <KeyHint>Enter</KeyHint>
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Try again <KeyHint>Esc</KeyHint>
            </Button>
          </PopoverActions>
        </Popover>
      </div>
    );
  },
};
