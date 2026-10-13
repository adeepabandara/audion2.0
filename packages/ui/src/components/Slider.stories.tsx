import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Slider } from './Slider';

const meta: Meta = { title: 'Components/Slider', component: Slider as never };
export default meta;
type Story = StoryObj;

export const Speed: Story = {
  render: () => {
    const [v, setV] = useState(1);
    return (
      <div style={{ maxWidth: 320 }}>
        <Slider
          label="Speaking speed"
          min={0.75}
          max={1.5}
          step={0.05}
          value={v}
          onValueChange={setV}
          format={(x) => `${x.toFixed(2)}×`}
        />
      </div>
    );
  },
};
