import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { updatePrefs } from '../store';
import type { Item, PhotoInfo } from '../types';
import { fmtBytes, fmtDate, itemTime } from '../util';
import { IconClose, IconGlobe } from '../icons';

const cache = new Map<string, PhotoInfo>();

/** Details zum aktuellen Foto (Taste I): Aufnahme, Kamera, Belichtung, Ort. */
export function InfoPanel({ it }: { it: Item }) {
  const [info, setInfo] = useState<PhotoInfo | null>(cache.get(it.path) ?? null);
  useEffect(() => {
    if (cache.has(it.path)) return setInfo(cache.get(it.path)!);
    setInfo(null);
    let alive = true;
    window.api.photoInfo(it.path).then((r) => {
      cache.set(it.path, r);
      if (cache.size > 500) cache.delete(cache.keys().next().value!);
      if (alive) setInfo(r);
    }).catch(() => alive && setInfo({}));
    return () => {
      alive = false;
    };
  }, [it.path]);
  const rows: [string, string][] = [];
  const add = (k: string, v?: string | null) => v && rows.push([k, v]);
  add(t('info.taken'), info?.taken ? fmtDate(info.taken) : fmtDate(itemTime(it)));
  add(t('info.size'), fmtBytes(it.size));
  if (info?.width && info.height) add(t('info.resolution'), `${info.width} × ${info.height} · ${((info.width * info.height) / 1e6).toFixed(1)} MP`);
  add(t('info.camera'), info?.camera);
  add(t('info.lens'), info?.lens);
  const exp = [info?.focal, info?.aperture, info?.exposure, info?.iso].filter(Boolean).join(' · ');
  add(t('info.exposure'), exp);
  if (info?.flash) add(t('info.flash'), t('info.flashOn'));
  add(t('info.folder'), it.dir || '–');
  const hasGps = info?.lat != null && info?.lon != null;
  return (
    <aside className="info-panel" data-testid="info-panel" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="ip-name ellipsis" title={it.name}>
            {it.name}
          </div>
          <div className="faint small">{it.ext.slice(1).toUpperCase()}{it.live ? ' · Live Photo' : ''}{it.sidecars.length ? ` · +${it.sidecars.length} ${t('info.sidecars')}` : ''}</div>
        </div>
        <button className="btn icon ghost sm" onClick={() => updatePrefs({ showInfo: false })} aria-label={t('common.close')}>
          <IconClose size={14} />
        </button>
      </div>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {hasGps && (
        <button
          className="btn sm"
          onClick={() => window.api.openExternal(`https://www.openstreetmap.org/?mlat=${info!.lat!.toFixed(6)}&mlon=${info!.lon!.toFixed(6)}#map=15/${info!.lat!.toFixed(5)}/${info!.lon!.toFixed(5)}`)}
        >
          <IconGlobe size={14} />
          {t('info.map')}
        </button>
      )}
      {!info && <div className="faint small">{t('info.loading')}</div>}
    </aside>
  );
}
