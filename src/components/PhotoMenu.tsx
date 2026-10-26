import { t } from '../i18n';
import {
  useStore, closePhotoMenu, activeProfile, idsFor, sortIdsToTarget, trashIds, skipCurrent, goTo, openCompareIds, updatePrefs, toast,
} from '../store';
import { IconTrash, IconSkip, IconFolder, IconCopy, IconLayers, IconInfo, IconImage } from '../icons';
import { Floating, KeyCap } from './ui';

/** Rechtsklick auf ein Foto: alle wichtigen Aktionen an einer Stelle. */
export function PhotoMenu() {
  const m = useStore((s) => s.photoMenu);
  const s = useStore((st) => st.session);
  const showInfo = useStore((st) => st.settings.prefs.showInfo);
  if (!m || !s) return null;
  const it = s.byId.get(m.id);
  if (!it) return null;
  const ids = idsFor(m.id);
  const many = ids.length > 1;
  const targets = activeProfile().targets;
  const run = (fn: () => void) => () => {
    closePhotoMenu();
    fn();
  };
  const images = ids.filter((id) => s.byId.get(id)?.kind === 'image');
  return (
    <Floating x={m.x} y={m.y} className="menu photo-menu" onClose={closePhotoMenu}>
      <div className="small muted ellipsis" style={{ padding: '6px 10px 8px', fontWeight: 600, maxWidth: 260 }}>
        {many ? t('drag.photos', { n: ids.length }) : it.name}
      </div>
      {targets.length > 0 && (
        <>
          <div className="mh">{t('menu.photo.moveTo')}</div>
          <div className="pm-targets">
            {targets.map((tg) => (
              <button key={tg.id} className="mi" onClick={run(() => sortIdsToTarget(ids, tg.id))} data-testid="pm-target">
                <span className="dot" style={{ background: tg.color, width: 9, height: 9 }} />
                <span className="ellipsis">{tg.name}</span>
                {tg.key && <span className="k"><KeyCap k={tg.key} /></span>}
              </button>
            ))}
          </div>
          <div className="sep" />
        </>
      )}
      {!many && (
        <button className="mi" onClick={run(() => { goTo(it.id); skipCurrent(); })}>
          <IconSkip size={16} />
          {t('ses.skip')}
        </button>
      )}
      {images.length >= 2 && (
        <button className="mi" onClick={run(() => openCompareIds(images))}>
          <IconLayers size={16} />
          {t('menu.photo.compare')}
        </button>
      )}
      {!many && (
        <button className="mi" onClick={run(() => updatePrefs({ showInfo: !showInfo }))}>
          <IconInfo size={16} />
          {showInfo ? t('menu.photo.infoHide') : t('menu.photo.info')}
          <span className="k">I</span>
        </button>
      )}
      <div className="sep" />
      {!many && (
        <>
          <button className="mi" onClick={run(() => window.api.showItem(it.path))}>
            <IconFolder size={16} />
            {t('ses.openFolder')}
          </button>
          <button className="mi" onClick={run(() => window.api.openWithDefault(it.path))}>
            <IconImage size={16} />
            {t('menu.photo.open')}
          </button>
          <button
            className="mi"
            onClick={run(async () => {
              await navigator.clipboard.writeText(it.path).catch(() => {});
              toast('success', t('menu.photo.copied'), { timeout: 1500 });
            })}
          >
            <IconCopy size={16} />
            {t('menu.photo.copyPath')}
          </button>
          <div className="sep" />
        </>
      )}
      <button className="mi danger" onClick={run(() => trashIds(ids))} data-testid="pm-delete">
        <IconTrash size={16} />
        {many ? t('menu.photo.deleteMany', { n: ids.length }) : t('ses.delete')}
      </button>
    </Floating>
  );
}
