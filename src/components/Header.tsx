import { t } from '../i18n';
import {
  useStore, goHome, openDialog, setView, undo, setZen, toggleFullscreen, updatePrefs, setActiveProfile, otherFolder,
  openCompare, seriesCount, setQuery, findDuplicates, type Progress,
} from '../store';
import type { Filter, SortBy } from '../types';
import { Logo, MenuPopup, useMenu } from './ui';
import { SetupStepper } from './Setup';
import { tip } from './Tooltip';
import {
  IconArrowLeft, IconGrid, IconImage, IconUndo, IconEye, IconMaximize, IconMinimize, IconSettings, IconHelp,
  IconMore, IconSliders, IconCheck, IconTrash, IconSearch, IconChart, IconKeyboard, IconInfo, IconFolderOut, IconLayers, IconCopy,
} from '../icons';
import { basename, fmtBytes, fmtDuration, fmtNum, modKey } from '../util';

export function Header() {
  const screen = useStore((s) => s.screen);
  if (screen === 'session') return <SessionHeader />;
  return (
    <div className="header">
      <button
        className="brand no-drag"
        style={{ background: 'none', border: 0, padding: 0 }}
        onClick={() => screen === 'setup' && goHome()}
        {...(screen === 'setup' ? tip(t('ses.back')) : {})}
      >
        <Logo size={26} />
        {t('app.name')}
      </button>
      {screen === 'setup' && (
        <div className="header-center">
          <SetupStepper />
        </div>
      )}
      <span className="spacer" />
      <button className="btn icon ghost" onClick={() => openDialog({ type: 'settings', tab: 'help' })} {...tip(t('menu.help'), t('tip.help'), 'F1')}>
        <IconHelp size={19} />
      </button>
      <button className="btn icon ghost" data-testid="settings-btn" onClick={() => openDialog({ type: 'settings' })} {...tip(t('menu.settings'), t('tip.settings'))}>
        <IconSettings size={19} />
      </button>
    </div>
  );
}

function TransferPill({ p, showEta }: { p: Progress; showEta: boolean }) {
  const pct = p.fileTotal ? p.fileDone / p.fileTotal : 0;
  const remaining = Math.max(0, p.pendingBytes - p.bytesDone);
  const eta = p.speed > 0 ? (remaining / p.speed) * 1000 : 0;
  const big = p.fileTotal > 20 * 1024 * 1024;
  const r = 6.5;
  const circ = 2 * Math.PI * r;
  return (
    <div className="transfer-pill" data-testid="progress" {...tip(t('transfer.busy'), t('tip.transfer', { name: p.name }))}>
      <svg className="ring" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r={r} fill="none" stroke="var(--line-2)" strokeWidth="2.2" />
        <circle
          cx="8"
          cy="8"
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.2"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          transform="rotate(-90 8 8)"
          strokeLinecap="round"
        />
      </svg>
      <span className="ellipsis">
        {big ? `${fmtBytes(p.fileDone)} / ${fmtBytes(p.fileTotal)}` : t('transfer.busy')}
        {p.pending > 1 && ` · ${t('transfer.queue', { n: p.pending - 1 })}`}
        {showEta && eta > 2000 && ` · ${t('transfer.eta', { t: fmtDuration(eta) })}`}
      </span>
    </div>
  );
}

function SessionHeader() {
  const s = useStore((st) => st.session)!;
  const prefs = useStore((st) => st.settings.prefs);
  const profiles = useStore((st) => st.settings.profiles);
  const progress = useStore((st) => st.progress);
  const fullscreen = useStore((st) => st.fullscreen);
  const expert = prefs.mode === 'expert';
  const more = useMenu();
  const viewMenu = useMenu();
  const total = s.items.length;
  const done = s.done.size;
  const mod = modKey();
  const nSeries = seriesCount(s);
  const title = s.sources.length > 1 ? `${basename(s.sources[0])} + ${s.sources.length - 1}` : basename(s.source);

  const check = (on: boolean) => <span style={{ width: 16, display: 'inline-grid' }}>{on && <IconCheck size={15} />}</span>;

  return (
    <div className="header bordered">
      <button className="btn icon ghost" onClick={goHome} data-testid="back-home" {...tip(t('ses.back'), t('tip.back'))}>
        <IconArrowLeft size={18} />
      </button>
      <div className="ses-title">
        <span className="name ellipsis" {...tip(title, s.sources.join(' · '))}>
          {title}
        </span>
        <span className="badge" data-testid="status" {...tip(t('tip.counterTitle'), t('tip.counter', { done: fmtNum(done), total: fmtNum(total) }))}>
          {t('ses.counter', { done: fmtNum(done), total: fmtNum(total) })}
        </span>
        {s.selection.size > 1 && <span className="badge accent">{t('ses.selected', { n: fmtNum(s.selection.size) })}</span>}
        {progress && <TransferPill p={progress} showEta={prefs.showEta} />}
      </div>

      <div className="header-center">
        <div className="seg">
          <button className={s.view === 'single' ? 'on' : ''} onClick={() => setView('single')} data-testid="view-single" {...tip(t('view.single'), t('tip.viewSingle'), 'Tab')}>
            <IconImage size={15} />
            {t('view.single')}
          </button>
          <button className={s.view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} data-testid="view-grid" {...tip(t('view.grid'), t('tip.viewGrid'), 'Tab')}>
            <IconGrid size={15} />
            {t('view.grid')}
          </button>
        </div>
      </div>

      <span className="spacer" />

      {s.view === 'grid' && !s.compare && (
        <input
          className="input sm ses-search no-drag"
          type="search"
          placeholder={t('ses.search')}
          defaultValue={s.query}
          data-testid="search"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.currentTarget.value = '';
              setQuery('');
              e.currentTarget.blur();
            }
          }}
        />
      )}
      {s.view === 'grid' && s.selection.size >= 2 && !s.compare && (
        <button className="btn sm primary" onClick={openCompare} data-testid="compare-selection" {...tip(t('series.compareSel'), t('tip.compareSel'))}>
          <IconLayers size={15} />
          {t('series.compareSel')}
        </button>
      )}
      <button
        className={`series-pill ${prefs.seriesEnabled ? 'on' : ''}`}
        onClick={() => updatePrefs({ seriesEnabled: !prefs.seriesEnabled })}
        data-testid="series-toggle"
        {...tip(prefs.seriesEnabled ? t('series.on') : t('series.off'), t('tip.series'))}
      >
        <IconLayers size={14} />
        {t('series.label')}
        {prefs.seriesEnabled ? <span className="n">{nSeries}</span> : <span>{t('series.offShort')}</span>}
      </button>
      <button className="btn icon ghost" onClick={undo} disabled={!s.undo.length} data-testid="undo" {...tip(t('ses.undo'), t('tip.undo'), `${mod} Z`)}>
        <IconUndo size={18} />
      </button>
      {expert && (
        <>
          <button className="btn icon ghost" onClick={(e) => viewMenu.open(e, 'right', 250)} {...tip(t('ses.options'), t('tip.options'))}>
            <IconSliders size={18} />
          </button>
          <button className="btn icon ghost" onClick={() => setZen(true)} {...tip(t('ses.focus'), t('tip.zen'), 'F10')}>
            <IconEye size={18} />
          </button>
          <button className="btn icon ghost" onClick={toggleFullscreen} {...tip(t(fullscreen ? 'ses.exitFullscreen' : 'ses.fullscreen'), t('tip.fullscreen'), 'F11')}>
            {fullscreen ? <IconMinimize size={18} /> : <IconMaximize size={18} />}
          </button>
        </>
      )}
      <button className="btn icon ghost" onClick={(e) => more.open(e, 'right', 270)} data-testid="menu-btn" {...tip(t('common.more'), t('tip.more'))}>
        <IconMore size={18} />
      </button>

      <div className="ses-progress">
        <div style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>

      <MenuPopup at={viewMenu.at} onClose={viewMenu.close}>
        <div className="mh">{t('ses.filter')}</div>
        {(['all', 'images', 'videos', 'skipped', ...(s.dupes.size ? ['duplicates'] : [])] as Filter[]).map((f) => (
          <button key={f} className="mi" onClick={() => updatePrefs({ filter: f })}>
            {check(prefs.filter === f)}
            {t(`ses.filter.${f}`)}
          </button>
        ))}
        <div className="sep" />
        <div className="mh">{t('ses.sort')}</div>
        {(['name', 'date', 'size', 'type'] as SortBy[]).map((f) => (
          <button key={f} className="mi" onClick={() => updatePrefs({ sortBy: f })}>
            {check(prefs.sortBy === f)}
            {t(`ses.sort.${f}`)}
          </button>
        ))}
        <button className="mi" onClick={() => updatePrefs({ sortDir: prefs.sortDir === 'asc' ? 'desc' : 'asc' })}>
          {check(prefs.sortDir === 'desc')}
          {t('ses.sort.desc')}
        </button>
        <div className="sep" />
        <div className="mh">{t('ses.mode')}</div>
        <button className="mi" onClick={() => updatePrefs({ transferMode: 'move' })}>
          {check(prefs.transferMode === 'move')}
          {t('ses.mode.move')}
        </button>
        <button className="mi" onClick={() => updatePrefs({ transferMode: 'copy' })}>
          {check(prefs.transferMode === 'copy')}
          {t('ses.mode.copy')}
        </button>
        {profiles.length > 1 && (
          <>
            <div className="sep" />
            <div className="mh">{t('setup.targets.set')}</div>
            {profiles.map((p) => (
              <button key={p.id} className="mi" onClick={() => setActiveProfile(p.id)}>
                {check(s.profileId === p.id)}
                {p.name}
              </button>
            ))}
          </>
        )}
      </MenuPopup>

      <MenuPopup at={more.at} onClose={more.close}>
        {expert && (
          <button className="mi" onClick={otherFolder}>
            <IconFolderOut size={16} />
            {t('ses.other')}
            <span className="k">Enter</span>
          </button>
        )}
        {!expert && (
          <button className="mi" onClick={toggleFullscreen}>
            {fullscreen ? <IconMinimize size={16} /> : <IconMaximize size={16} />}
            {t(fullscreen ? 'ses.exitFullscreen' : 'ses.fullscreen')}
            <span className="k">F11</span>
          </button>
        )}
        <button className="mi" onClick={() => openDialog({ type: 'summary' })}>
          <IconChart size={16} />
          {t('menu.summary')}
        </button>
        <button className="mi" onClick={findDuplicates} data-testid="find-dupes">
          <IconCopy size={16} />
          {t('menu.dupes')}
        </button>
        {s.dupes.size > 0 && prefs.filter !== 'duplicates' && (
          <button className="mi" onClick={() => { setView('grid'); updatePrefs({ filter: 'duplicates' }); }}>
            <IconLayers size={16} />
            {t('dupes.show')}
            <span className="k">{s.dupes.size}</span>
          </button>
        )}
        <button className="mi" onClick={() => openDialog({ type: 'trash' })}>
          <IconTrash size={16} />
          {t('menu.trash')}
        </button>
        {expert && (
          <button className="mi" onClick={() => openDialog({ type: 'lost' })}>
            <IconSearch size={16} />
            {t('menu.lost')}
          </button>
        )}
        <div className="sep" />
        <button className="mi" onClick={() => openDialog({ type: 'settings', tab: 'help' })}>
          <IconKeyboard size={16} />
          {t('menu.help')}
          <span className="k">F1</span>
        </button>
        <button className="mi" onClick={() => openDialog({ type: 'settings' })}>
          <IconSettings size={16} />
          {t('menu.settings')}
        </button>
        <button className="mi" onClick={() => openDialog({ type: 'settings', tab: 'about' })}>
          <IconInfo size={16} />
          {t('menu.about')}
        </button>
      </MenuPopup>
    </div>
  );
}
