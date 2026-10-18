import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

const meta = { title: 'Components/Modal', component: Modal } satisfies Meta<typeof Modal>;
export default meta;
type Story = StoryObj;

export const Basic: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open</Button>
        <Modal
          open={open}
          onOpenChange={setOpen}
          title="Ask someone to listen"
          description="Share a voice note."
        >
          <p>The pop-up content goes here.</p>
        </Modal>
      </>
    );
  },
};
