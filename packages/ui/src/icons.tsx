import type { SVGProps } from 'react';

const PATHS = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l3 3 5-6" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 17h.01" />
    </>
  ),
  camera: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2.5" />
      <path d="M16 10.5l5-3v9l-5-3z" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21" />
    </>
  ),
  play: <path d="M8 5.5v13l11-6.5z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  hand: (
    <path d="M8 12V6.5a1.5 1.5 0 013 0V11m0-5.5a1.5 1.5 0 013 0V11m0-4a1.5 1.5 0 013 0v7c0 3.5-2.5 6-6 6-2.6 0-4-1.2-5.4-3.3L4.8 13a1.5 1.5 0 012.4-1.6L8 12.5" />
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9S14.6 18.4 12 21c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" />
    </>
  ),
  wave: <path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 10v4M21.5 12h-.5" />,
  refresh: (
    <>
      <path d="M20 12a8 8 0 01-14 5.3M4 12a8 8 0 0114-5.3" />
      <path d="M18 3v4h-4M6 21v-4h4" />
    </>
  ),
  spinner: <path d="M12 3a9 9 0 019 9" />,
  alert: (
    <>
      <path d="M12 3.5l9.5 16.5h-19z" />
      <path d="M12 10v4.5M12 17.5h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5h.01" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  gear: (
    <>
      <path d="M10.26 5.01 L10.66 2.49 L13.34 2.49 L13.74 5.01 L15.71 5.83 L17.78 4.33 L19.67 6.22 L18.17 8.29 L18.99 10.26 L21.51 10.66 L21.51 13.34 L18.99 13.74 L18.17 15.71 L19.67 17.78 L17.78 19.67 L15.71 18.17 L13.74 18.99 L13.34 21.51 L10.66 21.51 L10.26 18.99 L8.29 18.17 L6.22 19.67 L4.33 17.78 L5.83 15.71 L5.01 13.74 L2.49 13.34 L2.49 10.66 L5.01 10.26 L5.83 8.29 L4.33 6.22 L6.22 4.33 L8.29 5.83z" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  'chevron-down': <path d="M6 9.5l6 6 6-6" />,
  'chevron-up': <path d="M6 14.5l6-6 6 6" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7.5a2 2 0 002 2h2.5" />
    </>
  ),
  'thumbs-up': (
    <path d="M7 11v9H4v-9zM7 11l4-7c1.7 0 2.5 1.2 2.2 2.8L12.8 9H19a2 2 0 012 2.3l-1.2 6.5A2.5 2.5 0 0117.4 20H7" />
  ),
  'thumbs-down': (
    <path d="M7 13V4H4v9zM7 13l4 7c1.7 0 2.5-1.2 2.2-2.8L12.8 15H19a2 2 0 002-2.3l-1.2-6.5A2.5 2.5 0 0017.4 4H7" />
  ),
  grip: (
    <>
      <circle cx="9" cy="7" r="1" />
      <circle cx="15" cy="7" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="9" cy="17" r="1" />
      <circle cx="15" cy="17" r="1" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  /** Provide only when the icon carries meaning on its own; otherwise it is hidden from assistive tech. */
  title?: string;
}

export function Icon({ name, size = 20, title, className, ...rest }: IconProps) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true };
  return (
    <svg
      {...rest}
      {...a11y}
      className={['au-icon', name === 'spinner' ? 'au-spin' : '', className]
        .filter(Boolean)
        .join(' ')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={name === 'play' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}
