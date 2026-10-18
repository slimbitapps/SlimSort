import { t } from '../i18n';
import {
  useStore, goHome, openDialog, setView, undo, setZen, toggleFullscreen, updatePrefs, setActiveProfile, otherFolder,
  type Progress,
} from '../store';
import type { Filter, SortBy } from '../types';
import { Logo, MenuPopup, useMenu } from './ui';
import { SetupStepper } from './Setup';
import {
  IconArrowLeft, IconGrid, IconImage, IconUndo, IconEye, IconMaximize, IconMinimize, IconSettings, IconHelp,
  IconMore, IconSliders, IconCheck, IconTrash, IconSearch, IconChart, IconKeyboard, IconInfo, IconFolderOut,
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
      <button className="btn icon ghost" title={t('menu.help')} aria-label={t('menu.help')} onClick={() => openDialog({ type: 'settings', tab: 'help' })}>
        <IconHelp size={19} />
      </button>
      <button
        className="btn icon ghost"
        title={t('menu.settings')}
        aria-label={t('menu.settings')}
        data-testid="settings-btn"
        onClick={() => openDialog({ type: 'settings' })}
      >
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
    <div className="transfer-pill" data-testid="progress" title={p.name}>
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

  const check = (on: boolean) => <span style={{ width: 16, display: 'inline-grid' }}>{on && <IconCheck size={15} />}</span>;

  return (
    <div className="header bordered">
      <button className="btn icon ghost" onClick={goHome} title={t('ses.back')} aria-label={t('ses.back')} data-testid="back-home">
        <IconArrowLeft size={18} />
      </button>
      <div className="ses-title">
        <span className="name ellipsis" title={s.source}>
          {basename(s.source)}
        </span>
        <span className="badge" data-testid="status">
          {t('ses.counter', { done: fmtNum(done), total: fmtNum(total) })}
        </span>
        {s.selection.size > 1 && <span className="badge accent">{t('ses.selected', { n: fmtNum(s.selection.size) })}</span>}
        {progress && <TransferPill p={progress} showEta={prefs.showEta} />}
      </div>

      <div className="header-center">
        <div className="seg">
          <button className={s.view === 'single' ? 'on' : ''} onClick={() => setView('single')} data-testid="view-single" title={`${t('view.single')} (Tab)`}>
            <IconImage size={15} />
            {t('view.single')}
          </button>
          <button className={s.view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} data-testid="view-grid" title={`${t('view.grid')} (Tab)`}>
            <IconGrid size={15} />
            {t('view.grid')}
          </button>
        </div>
      </div>

      <span className="spacer" />

      <button className="btn icon ghost" onClick={undo} disabled={!s.undo.length} title={`${t('ses.undo')} (${mod}+Z)`} aria-label={t('ses.undo')} data-testid="undo">
        <IconUndo size={18} />
      </button>
      {expert && (
        <button className="btn icon ghost" onClick={(e) => viewMenu.open(e, 'right', 250)} title={t('ses.options')} aria-label={t('ses.options')}>
          <IconSliders size={18} />
        </button>
      )}
      <button className="btn icon ghost" onClick={() => setZen(true)} title={`${t('ses.focus')} (F10)`} aria-label={t('ses.focus')}>
        <IconEye size={18} />
      </button>
      <button className="btn icon ghost" onClick={toggleFullscreen} title={`${t(fullscreen ? 'ses.exitFullscreen' : 'ses.fullscreen')} (F11)`} aria-label={t('ses.fullscreen')}>
        {fullscreen ? <IconMinimize size={18} /> : <IconMaximize size={18} />}
      </button>
      <button className="btn icon ghost" onClick={(e) => more.open(e, 'right', 260)} aria-label={t('common.more')} data-testid="menu-btn">
        <IconMore size={18} />
      </button>

      <div className="ses-progress">
        <div style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>

      <MenuPopup at={viewMenu.at} onClose={viewMenu.close}>
        <div className="mh">{t('ses.filter')}</div>
        {(['all', 'images', 'videos', 'skipped'] as Filter[]).map((f) => (
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
        <button className="mi" onClick={otherFolder}>
          <IconFolderOut size={16} />
          {t('ses.other')}
          <span className="k">Enter</span>
        </button>
        <button className="mi" onClick={() => openDialog({ type: 'summary' })}>
          <IconChart size={16} />
          {t('menu.summary')}
        </button>
        <button className="mi" onClick={() => openDialog({ type: 'trash' })}>
          <IconTrash size={16} />
          {t('menu.trash')}
        </button>
        <button className="mi" onClick={() => openDialog({ type: 'lost' })}>
          <IconSearch size={16} />
          {t('menu.lost')}
        </button>
        <div className="sep" />
        <button className="mi" onClick={() => openDialog({ type: 'settings', tab: 'help' })}>
          <IconKeyboard size={16} />
          {t('menu.shortcuts')}
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

