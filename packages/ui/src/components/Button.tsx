import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  /** Icon-only button: `children` is used as the accessible name. */
  iconOnly?: boolean;
  children: ReactNode;
}

// forwardRef: Radix `asChild` triggers (Tooltip, Dialog.Close) need the DOM ref.
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', icon, iconOnly, className, children, type = 'button', ...rest },
  ref,
) {
  const cls = ['au-btn', `au-btn--${variant}`, iconOnly && 'au-btn--icon', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cls}
      aria-label={iconOnly ? String(children) : rest['aria-label']}
    >
      {icon && <Icon name={icon} />}
      {!iconOnly && children}
    </button>
  );
});
