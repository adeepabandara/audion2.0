import { createContext, useContext, type HTMLAttributes, type ReactNode } from 'react';
import * as Portal from '@radix-ui/react-portal';

export type Theme = 'system' | 'light' | 'dark';

const ThemeContext = createContext<{ theme: Theme; portalContainer?: HTMLElement | null }>({
  theme: 'system',
});

export interface ThemeRootProps extends HTMLAttributes<HTMLDivElement> {
  theme?: Theme;
  /** Where overlays (popover, drawer, tooltip) mount. Inside a Shadow DOM pass an element within the shadow root. */
  portalContainer?: HTMLElement | null;
}

/** Root of every Audion surface: carries the tokens. Put it inside the Shadow root. */
export function ThemeRoot({
  theme = 'system',
  portalContainer,
  className,
  children,
  ...rest
}: ThemeRootProps) {
  return (
    <ThemeContext.Provider value={{ theme, portalContainer }}>
      <div
        {...rest}
        className={['au-root', className].filter(Boolean).join(' ')}
        data-theme={theme}
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

/** Portals content but keeps the tokens: the wrapper re-establishes `.au-root`, so overlays are styled anywhere. */
export function ThemedPortal({ children }: { children: ReactNode }) {
  const { theme, portalContainer } = useContext(ThemeContext);
  return (
    <Portal.Root asChild container={portalContainer ?? undefined}>
      <div className="au-root" data-theme={theme} style={{ background: 'transparent' }}>
        {children}
      </div>
    </Portal.Root>
  );
}
