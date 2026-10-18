import { t } from '../i18n';
import {
  useStore, goHome, setView, updatePrefs, undo, skipCurrent, trashCurrent, otherFolder, toggleFullscreen,
  setZen, setActiveProfile,
} from '../store';
import {
  IconHome, IconGrid, IconImage, IconUndo, IconSkip, IconTrash, IconFolderOut, IconMaximize, IconMinimize,
  IconEye, IconArrowDown, IconArrowUp, IconMove, IconCopy,
} from '../icons';
import { Help } from './ui';
import { GridView } from './GridView';
import { SingleView } from './SingleView';
import { Filmstrip } from './Filmstrip';
import { TargetBar } from './TargetBar';
import { fmtNum, modKey } from '../util';
import type { Filter, SortBy } from '../types';

export function Session() {
  const s = useStore((st) => st.session)!;
  const prefs = useStore((st) => st.settings.prefs);
  const profiles = useStore((st) => st.settings.profiles);
  const fullscreen = useStore((st) => st.fullscreen);
  const zen = useStore((st) => st.zen);
  const expert = prefs.mode === 'expert';
  const total = s.items.length;
  const done = s.done.size;

  return (
    <div className="session" data-testid="session">
      <div className="toolbar-wrap">
      <div className="toolbar">
        <button className="btn icon ghost" onClick={goHome} title={t('tb.home')} aria-label={t('tb.home')}>
          <IconHome />
        </button>
        <div className="seg" title={t('tb.viewTip')}>
          <button className={s.view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} data-testid="view-grid">
            <IconGrid size={15} />
            <span className="lbl-sm">{t('tb.grid')}</span>
          </button>
          <button className={s.view === 'single' ? 'on' : ''} onClick={() => setView('single')} data-testid="view-single">
            <IconImage size={15} />
            <span className="lbl-sm">{t('tb.single')}</span>
          </button>
        </div>
        <Help topic="view" />

        {expert && (
          <>
            <div className="sep" />
            <select
              className="select"
              value={prefs.filter}
              title={t('tb.filter')}
              data-testid="filter"
              onChange={(e) => updatePrefs({ filter: e.target.value as Filter })}
            >
              {(['all', 'images', 'videos', 'skipped'] as Filter[]).map((f) => (
                <option key={f} value={f}>
                  {t(`tb.filter.${f}` as const)}
                </option>
              ))}
            </select>
            <select
              className="select"
              value={prefs.sortBy}
              title={t('tb.sort')}
              data-testid="sort"
              onChange={(e) => updatePrefs({ sortBy: e.target.value as SortBy })}
            >
              {(['name', 'date', 'size', 'type'] as SortBy[]).map((f) => (
                <option key={f} value={f}>
                  {t(`tb.sort.${f}` as const)}
                </option>
              ))}
            </select>
            <button
              className="btn icon"
              title={t('tb.sortDir')}
              onClick={() => updatePrefs({ sortDir: prefs.sortDir === 'asc' ? 'desc' : 'asc' })}
            >
              {prefs.sortDir === 'asc' ? <IconArrowDown size={16} /> : <IconArrowUp size={16} />}
            </button>
            <Help topic="filter" />
            <div className="sep" />
            <div className="seg" title={t('tb.modeTip')} data-testid="transfer-mode">
              <button className={prefs.transferMode === 'move' ? 'on' : ''} onClick={() => updatePrefs({ transferMode: 'move' })}>
                <IconMove size={15} />
                <span className="lbl-md">{t('tb.move')}</span>
              </button>
              <button className={prefs.transferMode === 'copy' ? 'on' : ''} onClick={() => updatePrefs({ transferMode: 'copy' })}>
                <IconCopy size={15} />
                <span className="lbl-md">{t('tb.copy')}</span>
              </button>
            </div>
            <Help topic="mode" />
            <div className="sep" />
            <select
              className="select"
              value={s.profileId}
              title={t('tb.profile')}
              onChange={(e) => setActiveProfile(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </>
        )}

        <div className="status grow ellipsis" data-testid="status">
          {t('tb.counter', { done: fmtNum(done), total: fmtNum(total) })}
          {' · '}
          {t('tb.remaining', { n: fmtNum(total - done) })}
          {s.selection.size > 1 && ` · ${t('tb.selected', { n: fmtNum(s.selection.size) })}`}
        </div>

        <button className="btn ghost" onClick={undo} disabled={!s.undo.length} title={`${t('tb.undo')} (${modKey()}+Z)`} data-testid="undo">
          <IconUndo size={16} />
          <span className="lbl-md">{t('tb.undo')}</span>
        </button>
        <button className="btn ghost" onClick={skipCurrent} title={`${t('tb.skip')} (${t('key.space')})`} data-testid="skip">
          <IconSkip size={16} />
          <span className="lbl-md">{t('tb.skip')}</span>
        </button>
        <button className="btn ghost danger" onClick={trashCurrent} title={`${t('tb.delete')} (${t('key.del')})`} data-testid="delete">
          <IconTrash size={16} />
          <span className="lbl-md">{t('tb.delete')}</span>
        </button>
        <button className="btn ghost" onClick={otherFolder} title={`${t('tb.other')} (Enter)`}>
          <IconFolderOut size={16} />
          <span className="lbl-md">{t('tb.other')}</span>
        </button>
        <div className="sep" />
        <button className={`btn icon ghost ${zen ? 'active' : ''}`} onClick={() => setZen(!zen)} title={t('tb.zen')} aria-label={t('tb.zen')}>
          <IconEye size={17} />
        </button>
        <button className="btn icon ghost" onClick={toggleFullscreen} title={t('tb.fullscreen')} aria-label={t('tb.fullscreen')}>
          {fullscreen ? <IconMinimize size={17} /> : <IconMaximize size={17} />}
        </button>
      </div>
      </div>

      <div className="stage-wrap">{s.view === 'grid' ? <GridView s={s} /> : <SingleView s={s} />}</div>
      {s.view === 'single' && prefs.showFilmstrip ? <Filmstrip s={s} /> : <div />}
      <TargetBar s={s} />
    </div>
  );
}
