import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
  panel: ReactNode;
}

export interface TabsProps {
  label: string;
  tabs: TabItem[];
  defaultId?: string;
}

/** Tabs with the keyboard pattern people expect: arrows (and Home/End) move between tabs, Tab enters the panel. */
export function Tabs({ label, tabs, defaultId }: TabsProps) {
  const base = useId();
  const [active, setActive] = useState(defaultId ?? tabs[0]!.id);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const go = (id: string) => {
    setActive(id);
    buttons.current.get(id)?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === active);
    const next =
      e.key === 'ArrowRight'
        ? i + 1
        : e.key === 'ArrowLeft'
          ? i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? tabs.length - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    go(tabs[(next + tabs.length) % tabs.length]!.id);
  };
  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = (id: string) => `${base}-panel-${id}`;
  return (
    <div className="au-tabs">
      <div role="tablist" aria-label={label} className="au-tabs__list" onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              if (el) buttons.current.set(t.id, el);
            }}
            id={tabId(t.id)}
            type="button"
            role="tab"
            aria-selected={t.id === active}
            aria-controls={panelId(t.id)}
            tabIndex={t.id === active ? 0 : -1}
            className="au-tabs__tab"
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          id={panelId(t.id)}
          role="tabpanel"
          aria-labelledby={tabId(t.id)}
          hidden={t.id !== active}
          className="au-tabs__panel"
        >
          {t.id === active ? t.panel : null}
        </div>
      ))}
    </div>
  );
}
