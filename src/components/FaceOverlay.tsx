import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useStore } from '../store';
import { useAi } from '../ai';
import { facesOn, addSample, people, displayName, removeSampleNear, type FaceHit } from '../people';
import { refreshRules } from '../ai';
import type { Item } from '../types';
import { Floating } from './ui';

/**
 * Gesichter im Foto mit Namen. Klick auf ein Gesicht → benennen oder korrigieren.
 * Liegt genau über dem angezeigten Bild (gleiche Größe/Verschiebung), Kästen relativ zur Bildgröße.
 */
export function FaceOverlay({ it, style }: { it: Item; style: React.CSSProperties }) {
  const on = useStore((s) => s.settings.prefs.aiFaces && s.settings.prefs.showFaces && s.settings.prefs.aiEnabled);
  const list = useStore((s) => s.settings.people);
  const ready = useAi((a) => !!a.status?.facesReady && !!a.status?.faces);
  const [faces, setFaces] = useState<FaceHit[] | null>(null);
  const [edit, setEdit] = useState<{ i: number; x: number; y: number } | null>(null);

  useEffect(() => {
    setFaces(null);
    setEdit(null);
  }, [it.id]);

  useEffect(() => {
    if (!on || !ready || it.kind !== 'image') return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const r = await facesOn([it.id], true);
      if (stop) return;
      const f = r.get(it.id);
      if (f) setFaces(f);
      // noch nicht untersucht → gleich nochmal schauen
      else timer = setTimeout(load, 1500);
    };
    load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [it.id, on, ready, list]);

  if (!on || !faces || !faces.length) return null;
  return (
    <div className="face-layer" style={style} data-testid="face-layer">
      {faces.map((f, i) => {
        const [x, y, w, h] = f.box;
        const label = f.person ? displayName(f.person) : f.maybe ? `${displayName(f.maybe)}?` : '?';
        return (
          <button
            key={i}
            className={`face-box ${f.person ? 'known' : f.maybe ? 'maybe' : 'unknown'}`}
            style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
            data-testid="face-box"
            data-name={f.person?.name || ''}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setEdit({ i, x: e.clientX, y: e.clientY });
            }}
            title={f.person ? `${label} · ${Math.round(f.p * 100)} %` : t('face.clickToName')}
          >
            <span className="face-tag" data-testid="face-tag">
              {label}
            </span>
          </button>
        );
      })}
      {edit && faces[edit.i] && (
        <NameFace
          it={it}
          face={faces[edit.i]}
          x={edit.x}
          y={edit.y}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

function NameFace({ it, face, x, y, onClose }: { it: Item; face: FaceHit; x: number; y: number; onClose: () => void }) {
  const [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const list = people();
  const suggest = face.maybe ? [face.maybe, ...list.filter((p) => p !== face.maybe)] : list;
  useEffect(() => {
    input.current?.focus();
  }, []);
  const save = async (n: string) => {
    if (!n.trim() || !face.emb) return;
    const crop = await window.api.ai.faceCrop(it.path, face.box).catch(() => null);
    addSample(n, face.emb, crop);
    refreshRules();
    onClose();
  };
  return (
    <Floating x={x} y={y + 12} className="face-pop" onClose={onClose}>
      <div onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <div className="face-pop-title">{face.person ? t('face.isWho', { name: displayName(face.person) }) : t('face.whoIsThis')}</div>
        <form
          className="row"
          style={{ gap: 6 }}
          onSubmit={(e) => {
            e.preventDefault();
            save(name);
          }}
        >
          <input
            ref={input}
            className="input"
            value={name}
            placeholder={t('face.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
            list="face-names"
            data-testid="face-name-input"
          />
          <datalist id="face-names">
            {list.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
          <button className="btn primary sm" type="submit" disabled={!name.trim()} data-testid="face-name-ok">
            {t('common.ok')}
          </button>
        </form>
        {suggest.length > 0 && (
          <div className="face-chips">
            {!face.person && face.maybe && (
              <button className="chip primary" onClick={() => save(face.maybe!.me ? 'ich' : face.maybe!.name)}>
                {t('face.yesItIs', { name: displayName(face.maybe) })}
              </button>
            )}
            {suggest
              .filter((p) => p !== face.person && p !== face.maybe)
              .slice(0, 6)
              .map((p) => (
                <button key={p.id} className="chip" onClick={() => save(p.me ? 'ich' : p.name)}>
                  {displayName(p)}
                </button>
              ))}
            {!list.some((p) => p.me) && (
              <button className="chip" onClick={() => save('ich')}>
                {t('face.thatsMe')}
              </button>
            )}
          </div>
        )}
        {face.person && face.emb && (
          <button
            className="btn ghost sm"
            style={{ marginTop: 6 }}
            onClick={() => {
              removeSampleNear(face.person!.id, face.emb!);
              refreshRules();
              onClose();
            }}
          >
            {t('face.notThem', { name: displayName(face.person) })}
          </button>
        )}
      </div>
    </Floating>
  );
}
