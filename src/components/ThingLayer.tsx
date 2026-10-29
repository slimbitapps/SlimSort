import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useStore, toast } from '../store';
import { refreshRules } from '../ai';
import { things as getThings, thingsOn, addThingExample, addThingNegative, detectCategory, type ThingHit } from '../things';
import type { Item } from '../types';
import { Floating } from './ui';
import { IconCheck, IconClose } from '../icons';

/** Gemerkte Dinge auf dem Foto als Schilder oben links – mit ✓ (stimmt) und ✗ (stimmt nicht) */
export function ThingTags({ it }: { it: Item }) {
  const list = useStore((s) => s.settings.things);
  const on = useStore((s) => s.settings.prefs.aiEnabled && s.settings.prefs.showFaces);
  const session = useStore((s) => s.session);
  const [hits, setHits] = useState<ThingHit[]>([]);

  useEffect(() => {
    setHits([]);
    if (!on || !list?.length || it.kind !== 'image' || !session) return;
    let stop = false;
    const pool = session.items.filter((x) => x.kind === 'image').map((x) => x.id);
    thingsOn([it.id], pool).then((m) => !stop && setHits(m.get(it.id) || []));
    return () => {
      stop = true;
    };
  }, [it.id, list, on]); // eslint-disable-line

  if (!hits.length) return null;
  return (
    <div className="thing-tags" data-testid="thing-tags" onPointerDown={(e) => e.stopPropagation()}>
      {hits.map((h) => (
        <span key={h.thing.id} className="thing-tag" data-testid="thing-tag" data-name={h.thing.name} title={`${Math.round(h.p * 100)} %`}>
          {h.thing.name}
          <button
            className="tt-btn"
            aria-label={t('things.yes')}
            data-tip={t('things.yes')}
            onClick={async () => {
              await addThingExample(h.thing.name, it.path);
              refreshRules();
              toast('success', t('things.thanks', { name: h.thing.name }));
            }}
          >
            <IconCheck size={12} />
          </button>
          <button
            className="tt-btn"
            aria-label={t('things.no', { name: h.thing.name })}
            data-tip={t('things.no', { name: h.thing.name })}
            data-testid="thing-no"
            onClick={async () => {
              await addThingNegative(h.thing.id, it.path);
              refreshRules();
            }}
          >
            <IconClose size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}

/**
 * Bereich im Foto markieren ("das ist mein Auto"): Rahmen aufziehen, Namen eingeben.
 * Liegt genau über dem angezeigten Bild (gleiche Größe/Verschiebung wie das Bild).
 */
export function MarkLayer({ it, style, onDone }: { it: Item; style: React.CSSProperties; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [ask, setAsk] = useState<{ box: [number, number, number, number]; x: number; y: number } | null>(null);
  const [name, setName] = useState('');
  const rel = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const box = drag && ([Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0)] as [number, number, number, number]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onDone();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onDone]);

  const save = async (n = name) => {
    if (!ask || !n.trim()) return;
    try {
      const th = await addThingExample(n, it.path, ask.box);
      if (!th.category) detectCategory(th.id, it.id);
      refreshRules();
      toast('success', t('things.learnedToast', { name: th.name, n: th.examples.length }), { timeout: 5000 });
    } catch (e: any) {
      toast('error', String(e?.message || e));
    }
    onDone();
  };

  return (
    <div
      ref={ref}
      className="mark-layer"
      style={style}
      data-testid="mark-layer"
      onPointerDown={(e) => {
        e.stopPropagation();
        if (ask) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const p = rel(e);
        setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onPointerMove={(e) => {
        if (!drag || ask) return;
        const p = rel(e);
        setDrag({ ...drag, x1: p.x, y1: p.y });
      }}
      onPointerUp={(e) => {
        if (!drag || !box || ask) return;
        // zu klein → ganzes Foto
        const b: [number, number, number, number] = box[2] < 0.02 || box[3] < 0.02 ? [0, 0, 1, 1] : box;
        setAsk({ box: b, x: e.clientX, y: e.clientY });
      }}
    >
      {box && <div className="mark-box" style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${box[2] * 100}%`, height: `${box[3] * 100}%` }} />}
      {!drag && <div className="mark-hint">{t('things.markHint')}</div>}
      {ask && (
        <Floating x={ask.x} y={ask.y + 10} className="face-pop" onClose={onDone}>
          <div onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <div className="face-pop-title">{t('things.whatIsThis')}</div>
            <form
              className="row"
              style={{ gap: 6 }}
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <input
                className="input"
                autoFocus
                value={name}
                placeholder={t('things.namePlaceholder')}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && onDone()}
                list="thing-names"
                data-testid="thing-name-input"
              />
              <datalist id="thing-names">
                {getThings().map((x) => (
                  <option key={x.id} value={x.name} />
                ))}
              </datalist>
              <button className="btn primary sm" type="submit" disabled={!name.trim()} data-testid="thing-name-ok">
                {t('common.ok')}
              </button>
            </form>
            <div className="face-chips">
              {getThings()
                .slice(0, 6)
                .map((x) => (
                  <button key={x.id} className="chip" onClick={() => save(x.name)}>
                    {x.name}
                  </button>
                ))}
            </div>
          </div>
        </Floating>
      )}
    </div>
  );
}
