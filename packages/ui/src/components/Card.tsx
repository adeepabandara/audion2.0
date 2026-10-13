import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  title?: string;
  raised?: boolean;
  children: ReactNode;
}

export function Card({ title, raised, className, children, ...rest }: CardProps) {
  return (
    <section
      {...rest}
      className={['au-card', raised && 'au-card--raised', className].filter(Boolean).join(' ')}
    >
      {title && <h2 className="au-card__title">{title}</h2>}
      {children}
    </section>
  );
}
