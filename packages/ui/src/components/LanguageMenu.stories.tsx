import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { LanguageMenu, type LanguageOption } from './LanguageMenu';

const meta = { title: 'Components/LanguageMenu', component: LanguageMenu } satisfies Meta<
  typeof LanguageMenu
>;
export default meta;
type Story = StoryObj;

const OPTIONS: LanguageOption[] = [
  { value: 'en', label: 'English', flag: 'en', hint: 'No translation' },
  { value: 'es', label: 'Español', flag: 'es', hint: 'Spanish' },
  { value: 'fr', label: 'Français', flag: 'fr', hint: 'French' },
  { value: 'ja', label: '日本語', flag: 'ja', hint: 'Japanese' },
];

export const Picker: Story = {
  render: () => {
    const [v, setV] = useState('es');
    return (
      <LanguageMenu
        label="Translate sentences into"
        value={v}
        options={OPTIONS}
        onValueChange={setV}
        side="bottom"
        align="start"
      />
    );
  },
};
