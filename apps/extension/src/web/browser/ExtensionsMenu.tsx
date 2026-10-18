import { useEffect, useRef } from 'react';
import { setBrowser, useBrowser } from './browserState';

/**
 * The menu under the puzzle-piece icon, laid out like a browser's extensions menu: the list of installed extensions,
 * each with a pin button. Pinning Ola puts its icon in the toolbar. Closes with Escape or a click elsewhere.
 */
export function ExtensionsMenu() {
  const { menuOpen, installed, pinned } = useBrowser();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setBrowser({ menuOpen: false });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      close();
      document.getElementById('toolbar-puzzle')?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (root.current?.contains(t) || document.getElementById('toolbar-puzzle')?.contains(t))
        return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [menuOpen]);

  if (!menuOpen) return null;
  return (
    <div ref={root} className="extmenu" role="dialog" aria-label="Extensions">
      <h2 className="extmenu__title">Extensions</h2>
      {installed ? (
        <ul className="extmenu__list">
          <li className="extmenu__item">
            <img src="/icon/32.png" alt="" width={24} height={24} />
            <span className="extmenu__name">
              Ola by Audion
              <small>Can read and change data on the call site</small>
            </span>
            <button
              id="ext-pin"
              type="button"
              className={`extmenu__pin${pinned ? ' is-on' : ''}`}
              aria-pressed={pinned}
              aria-label={
                pinned ? 'Unpin Ola by Audion from the toolbar' : 'Pin Ola by Audion to the toolbar'
              }
              title={pinned ? 'Unpin from toolbar' : 'Pin to toolbar'}
              onClick={() => setBrowser({ pinned: !pinned })}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 3h6l-1 6 3 3v2h-4v7l-1 1-1-1v-7H7v-2l3-3-1-6z" />
              </svg>
            </button>
          </li>
        </ul>
      ) : (
        <p className="extmenu__empty">No extensions are installed yet.</p>
      )}
      <p className="extmenu__manage">Manage extensions</p>
    </div>
  );
}
