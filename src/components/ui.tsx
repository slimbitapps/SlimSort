import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t, type TKey } from '../i18n';
import { closeDialog } from '../store';
import { IconClose, IconHelp } from '../icons';

export function KeyCap({ k, lg, className = '' }: { k: string; lg?: boolean; className?: string }) {
  return <span className={`kbd ${lg ? 'lg' : ''} ${k ? '' : 'empty'} ${className}`}>{k || '–'}</span>;
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

/** Positioniert ein schwebendes Element am Bildschirmrand entlang. */
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
  const [pos, setPos] = useState({ left: x, top: y });
  useDismiss(true, onClose, ref);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = Math.min(x, window.innerWidth - r.width - 8);
    let top = anchorBottom ? y - r.height : y;
    if (top + r.height > window.innerHeight - 8) top = window.innerHeight - r.height - 8;
    left = Math.max(8, left);
    top = Math.max(8, top);
    setPos({ left, top });
  }, [x, y, anchorBottom]);
  return createPortal(
    <div ref={ref} className={className} style={pos} onContextMenu={(e) => e.preventDefault()}>
      {children}
    </div>,
    document.body
  );
}

/** Dezente "?"-Taste mit kurzer Erklärung. */
export function Help({ topic }: { topic: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
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
          setPos(pos ? null : { x: r.left, y: r.bottom + 8 });
        }}
      >
        ?
      </button>
      {pos && (
        <Floating x={pos.x} y={pos.y} className="help-pop" onClose={() => setPos(null)}>
          <h4>
            <IconHelp size={16} />
            {t(`help.${topic}.title` as TKey)}
          </h4>
          {t(`help.${topic}.body` as TKey)}
        </Floating>
      )}
    </>
  );
}

/** Hilfe mit beliebigem Text (z. B. für Einstellungen). */
export function HelpText({ title, text }: { title: string; text: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        type="button"
        className="help-btn"
        aria-label={t('common.help')}
        onClick={(e) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setPos(pos ? null : { x: r.left, y: r.bottom + 8 });
        }}
      >
        ?
      </button>
      {pos && (
        <Floating x={pos.x} y={pos.y} className="help-pop" onClose={() => setPos(null)}>
          <h4>
            <IconHelp size={16} />
            {title}
          </h4>
          {text}
        </Floating>
      )}
    </>
  );
}

export function Dialog({
  title, children, footer, wide, icon, onClose = closeDialog,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  icon?: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <header>
          {icon}
          <h2>{title}</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label={t('common.close')}>
            <IconClose />
          </button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}
