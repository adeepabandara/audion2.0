import type { Meta, StoryObj } from '@storybook/react';
import { ICON_NAMES, Icon } from './icons';

const meta = { title: 'Foundations/Icons', component: Icon } satisfies Meta<typeof Icon>;
export default meta;
export const AllIcons: StoryObj<typeof meta> = {
  args: { name: 'check' },
  render: () => (
    <ul
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, 120px)',
        gap: 16,
        listStyle: 'none',
        padding: 0,
      }}
    >
      {ICON_NAMES.map((n) => (
        <li key={n} style={{ display: 'grid', justifyItems: 'center', gap: 6 }}>
          <Icon name={n} size={28} />
          <span style={{ fontSize: 12 }}>{n}</span>
        </li>
      ))}
    </ul>
  ),
};
