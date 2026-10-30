import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t, type TKey } from '../i18n';
import { closeDialog } from '../store';
import { IconClose } from '../icons';

/** App-Logo: zwei Fotos auf einem Farbverlauf */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lg-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6b8bff" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id="lg-pic" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c95ff" />
          <stop offset="1" stopColor="#a17bff" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#lg-bg)" />
      <rect x="14" y="15" width="27" height="22" rx="4.5" fill="#fff" opacity="0.38" transform="rotate(-11 27.5 26)" />
      <rect x="21" y="22" width="30" height="25" rx="5" fill="#fff" />
      <circle cx="30" cy="30.5" r="3" fill="url(#lg-pic)" />
      <path d="M24 43.5l8.5-8 5.5 5 4-3.5 6 6.5z" fill="url(#lg-pic)" />
    </svg>
  );
}

export function KeyCap({
  k, size, className = '', onClick, title, tipText,
}: {
  k: string;
  size?: 'lg' | 'xl';
  className?: string;
  onClick?: () => void;
  title?: string;
  tipText?: string;
}) {
  return (
    <span
      className={`kbd ${size || ''} ${k ? '' : 'empty'} ${onClick ? 'clickable' : ''} ${className}`}
      onClick={onClick}
      data-tip={title}
      data-tip-text={tipText}
      role={onClick ? 'button' : undefined}
    >
      {k || '+'}
    </span>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`switch ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
    />
  );
}

/** Schließt ein Popover bei Klick daneben oder Esc. */
export function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const id = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(id);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, close, ref]);
}

/** Schwebendes Element (Menü, Hilfe), bleibt im sichtbaren Bereich. */
export function Floating({
  x, y, children, className, onClose, anchorBottom,
}: {
  x: number;
  y: number;
  children: ReactNode;
  className: string;
  onClose: () => void;
  anchorBottom?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, visibility: 'hidden' as 'hidden' | 'visible' });
  useDismiss(true, onClose, ref);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = Math.min(x, window.innerWidth - r.width - 10);
    let top = anchorBottom ? y - r.height : y;
    if (top + r.height > window.innerHeight - 10) top = window.innerHeight - r.height - 10;
    setPos({ left: Math.max(10, left), top: Math.max(10, top), visibility: 'visible' });
  }, [x, y, anchorBottom]);
  return createPortal(
    <div ref={ref} className={className} style={pos} onContextMenu={(e) => e.preventDefault()}>
      {children}
    </div>,
    document.body
  );
}

/** Menü, das an einem Knopf aufklappt. */
export function useMenu() {
  const [at, setAt] = useState<{ x: number; y: number; up?: boolean } | null>(null);
  const open = (e: React.MouseEvent, align: 'left' | 'right' = 'right', width = 240) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAt(at ? null : { x: align === 'right' ? r.right - width : r.left, y: r.bottom + 6 });
  };
  const openAt = (x: number, y: number, up = false) => setAt({ x, y, up });
  return { at, open, openAt, close: () => setAt(null) };
}

export function MenuPopup({
  at, onClose, children,
}: {
  at: { x: number; y: number; up?: boolean } | null;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!at) return null;
  return (
    <Floating x={at.x} y={at.y} anchorBottom={at.up} className="menu" onClose={onClose}>
      <div onClick={onClose}>{children}</div>
    </Floating>
  );
}

/** Dezente "?"-Taste mit kurzer, verständlicher Erklärung. */
export function Help({ topic, title, text }: { topic?: string; title?: string; text?: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const head = title ?? (topic ? t(`help.${topic}.title` as TKey) : '');
  const body = text ?? (topic ? t(`help.${topic}.body` as TKey) : '');
  return (
    <>
      <button
        type="button"
        className="help-btn"
        aria-label={t('common.help')}
        title={t('common.help')}
        onClick={(e) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setPos(pos ? null : { x: r.left - 10, y: r.bottom + 8 });
        }}
      >
        ?
      </button>
      {pos && (
        <Floating x={pos.x} y={pos.y} className="help-pop" onClose={() => setPos(null)}>
          {head && <h4>{head}</h4>}
          {body}
        </Floating>
      )}
    </>
  );
}

/** Kennzeichen „Beta“ für die KI: noch in Entwicklung – Vorschläge prüfen */
export function Beta() {
  return (
    <span className="beta-badge" data-tip={t('beta.tip')} data-testid="beta">
      Beta
    </span>
  );
}

export function Dialog({
  title, children, footer, size, icon, onClose = closeDialog, testId, beta,
}: {
  title: string;
  /** „Beta“-Kennzeichen hinter dem Titel (KI-Fenster) */
  beta?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'wide' | 'xwide';
  icon?: ReactNode;
  onClose?: () => void;
  testId?: string;
}) {
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${size || ''}`} role="dialog" aria-label={title} data-testid={testId}>
        <div className="d-head">
          {icon}
          <h2>
            {title}
            {beta && <Beta />}
          </h2>
          <button className="btn icon ghost sm" onClick={onClose} aria-label={t('common.close')}>
            <IconClose size={16} />
          </button>
        </div>
        <div className="d-body">{children}</div>
        {footer && <div className="d-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return <div className={`spinner ${small ? 'sm' : ''}`} />;
}

/** Leere Ansicht: erklärt, ob Fotos nur ausgeblendet sind (Filter/Suche/KI-Auswahl) */
export function EmptyView({ hidden, text, onShowAll }: { hidden: number; text: string; onShowAll: () => void }) {
  return (
    <div className="empty-view" data-testid="empty-view">
      {hidden > 0 ? (
        <>
          <div>{t('ses.hidden', { n: hidden })}</div>
          <button className="btn primary sm" onClick={onShowAll} data-testid="show-all" style={{ marginTop: 10 }}>
            {t('ses.showAll')}
          </button>
        </>
      ) : (
        text
      )}
    </div>
  );
}
