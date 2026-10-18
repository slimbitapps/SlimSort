import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Erklärungen beim Darüberfahren mit der Maus.
 * Ein einziger, globaler Beobachter – sparsam und überall nutzbar:
 *   <button {...tip('Rückgängig', 'Macht den letzten Schritt rückgängig', 'Strg+Z')}>
 */
export function tip(title: string, text?: string, keys?: string) {
  return {
    'data-tip': title,
    'data-tip-text': text || undefined,
    'data-tip-key': keys || undefined,
    'aria-label': title,
  } as Record<string, string | undefined>;
}

interface TipState {
  title: string;
  text?: string;
  keys?: string[];
  rect: DOMRect;
}

const DELAY = 450;

export function TooltipLayer() {
  const [tipState, setTip] = useState<TipState | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let current: HTMLElement | null = null;
    const hide = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      current = null;
      setTip(null);
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (el === current) return;
      hide();
      if (!el) return;
      current = el;
      timer = setTimeout(() => {
        if (!current || !document.body.contains(current)) return;
        const keys = current.dataset.tipKey;
        setTip({
          title: current.dataset.tip || '',
          text: current.dataset.tipText,
          keys: keys ? keys.split(' ') : undefined,
          rect: current.getBoundingClientRect(),
        });
      }, DELAY);
    };
    window.addEventListener('pointerover', onOver, true);
    window.addEventListener('pointerdown', hide, true);
    window.addEventListener('keydown', hide, true);
    window.addEventListener('wheel', hide, { capture: true, passive: true });
    window.addEventListener('blur', hide);
    return () => {
      window.removeEventListener('pointerover', onOver, true);
      window.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('keydown', hide, true);
      window.removeEventListener('wheel', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tipState || !ref.current) return setPos(null);
    const r = tipState.rect;
    const box = ref.current.getBoundingClientRect();
    let left = r.left + r.width / 2 - box.width / 2;
    left = Math.max(8, Math.min(window.innerWidth - box.width - 8, left));
    let top = r.bottom + 8;
    if (top + box.height > window.innerHeight - 8) top = r.top - box.height - 8;
    setPos({ left, top });
  }, [tipState]);

  if (!tipState) return null;
  return (
    <div
      ref={ref}
      className="tooltip"
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      <div className="tt-head">
        <span className="tt-title">{tipState.title}</span>
        {tipState.keys && (
          <span className="tt-keys">
            {tipState.keys.map((k, i) => (
              <span key={i} className="kbd">
                {k}
              </span>
            ))}
          </span>
        )}
      </div>
      {tipState.text && <div className="tt-text">{tipState.text}</div>}
    </div>
  );
}
