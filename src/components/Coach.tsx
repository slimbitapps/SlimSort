import { useLayoutEffect, useState } from 'react';
import { t } from '../i18n';
import { useStore, coachNext, coachEnd } from '../store';
import { modKey } from '../util';

/** Kurze Einführung beim ersten Sortieren: hebt nacheinander die wichtigsten Bereiche hervor. */
export const COACH_STEPS = [
  { sel: '[data-coach="targets"]', title: 'coach.1.title', text: 'coach.1.text' },
  { sel: '[data-coach="actions"]', title: 'coach.2.title', text: 'coach.2.text' },
  { sel: '[data-testid="undo"]', title: 'coach.3.title', text: 'coach.3.text' },
  { sel: '[data-coach="stage"]', title: 'coach.4.title', text: 'coach.4.text' },
] as const;

const PAD = 6;
const CARD_W = 340;

export function Coach() {
  const step = useStore((s) => s.coach);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (step === null) return;
    const measure = () => {
      const el = document.querySelector(COACH_STEPS[step].sel);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    const id = setTimeout(measure, 60);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(id);
      window.removeEventListener('resize', measure);
    };
  }, [step]);

  if (step === null) return null;
  const s = COACH_STEPS[step];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let cardStyle: React.CSSProperties = { left: vw / 2 - CARD_W / 2, top: vh / 2 - 90 };
  if (rect) {
    const below = vh - rect.bottom;
    const above = rect.top;
    const left = Math.max(16, Math.min(vw - CARD_W - 16, rect.left + rect.width / 2 - CARD_W / 2));
    if (rect.height > vh * 0.5) cardStyle = { left: vw / 2 - CARD_W / 2, top: rect.top + 24 };
    else if (above > below) cardStyle = { left, bottom: vh - rect.top + 18 };
    else cardStyle = { left, top: rect.bottom + 16 };
  }
  const last = step === COACH_STEPS.length - 1;

  return (
    <div className="coach-layer" data-testid="coach">
      {rect && (
        <div
          className="coach-hole"
          style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
        />
      )}
      <div className="coach-card" style={cardStyle} key={step}>
        <div className="faint small" style={{ marginBottom: 6, fontWeight: 600 }}>
          {t('coach.step', { n: step + 1, total: COACH_STEPS.length })}
        </div>
        <h4>{t(s.title)}</h4>
        <p>{t(s.text, { mod: modKey() })}</p>
        <div className="row">
          <button className="btn ghost sm" onClick={coachEnd}>
            {t('coach.skip')}
          </button>
          <span className="spacer" />
          <button className="btn primary" onClick={() => coachNext(COACH_STEPS.length)} data-testid="coach-next">
            {last ? t('coach.done') : t('common.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
