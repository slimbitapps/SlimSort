import { useDrag } from '../dnd';
import { t } from '../i18n';

/** Kleines Bild am Mauszeiger während des Ziehens. */
export function DragGhost() {
  const d = useDrag();
  if (!d) return null;
  const p = d.payload;
  return (
    <div className="drag-ghost" style={{ transform: `translate(${d.x + 14}px, ${d.y + 14}px)` }} data-testid="drag-ghost">
      {p.kind === 'photos' ? (
        <>
          {p.thumb && <img src={p.thumb} alt="" />}
          <span>{p.ids.length > 1 ? t('drag.photos', { n: p.ids.length }) : p.label}</span>
        </>
      ) : (
        <>
          <i style={{ background: p.color }} />
          <span>{p.label}</span>
        </>
      )}
    </div>
  );
}
