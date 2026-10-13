import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Button } from './Button';
import { Drawer } from './Drawer';
import { Toggle } from './Toggle';

const meta: Meta = { title: 'Components/Drawer', component: Drawer as never };
export default meta;
type Story = StoryObj;

export const Settings: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    const [chat, setChat] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open settings</Button>
        <Drawer
          open={open}
          onOpenChange={setOpen}
          title="Settings"
          description="Changes save automatically."
        >
          <div style={{ marginTop: 16 }}>
            <Toggle
              label="Also post sentences to Meet chat"
              checked={chat}
              onCheckedChange={setChat}
            />
          </div>
        </Drawer>
      </>
    );
  },
};
