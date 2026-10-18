import { useState } from 'react';
import { t } from '../i18n';
import {
  useStore, updatePrefs, openDialog, goHome, type Progress,
} from '../store';
import {
  IconMenu, IconSun, IconMoon, IconKeyboard, IconSettings, IconInfo, IconLayers, IconTrash,
  IconSearch, IconChart, IconHome, IconImage,
} from '../icons';
import { Floating, Help } from './ui';
import { fmtBytes, fmtDuration } from '../util';

function ProgressBox({ p, showEta }: { p: Progress; showEta: boolean }) {
  const pct = p.fileTotal ? Math.round((p.fileDone / p.fileTotal) * 100) : 0;
  const remaining = Math.max(0, p.pendingBytes - p.bytesDone);
  const eta = p.speed > 0 ? (remaining / p.speed) * 1000 : 0;
  const big = p.fileTotal > 20 * 1024 * 1024;
  return (
    <div className="progress" data-testid="progress">
      <div className="bar">
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="txt ellipsis">
        <span className="ellipsis">{p.name}</span>
        {big && ` · ${fmtBytes(p.fileDone)} / ${fmtBytes(p.fileTotal)}`}
        {p.pending > 1 && ` · ${t('progress.queue', { n: p.pending - 1 })}`}
        {showEta && eta > 1500 && ` · ${t('progress.eta', { t: fmtDuration(eta) })}`}
      </div>
      <Help topic="progress" />
    </div>
  );
}

export function TopBar() {
  const prefs = useStore((s) => s.settings.prefs);
  const progress = useStore((s) => s.progress);
  const screen = useStore((s) => s.screen);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const dark = prefs.theme !== 'light';
  const expert = prefs.mode === 'expert';

  const item = (icon: React.ReactNode, label: string, run: () => void, k?: string) => (
    <button
      className="mi"
      onClick={() => {
        setMenu(null);
        run();
      }}
    >
      {icon}
      {label}
      {k && <span className="k">{k}</span>}
    </button>
  );

  return (
    <div className="topbar">
      <div className="brand">
        <div className="logo">
          <IconImage size={15} />
        </div>
        <span>{t('app.name')}</span>
      </div>
      {progress && <ProgressBox p={progress} showEta={prefs.showEta} />}
      <div className="center" />
      <div className="seg" title={t('top.mode.tip')} data-testid="mode-switch">
        <button className={!expert ? 'on' : ''} onClick={() => updatePrefs({ mode: 'simple' })}>
          {t('top.mode.simple')}
        </button>
        <button className={expert ? 'on' : ''} onClick={() => updatePrefs({ mode: 'expert' })}>
          {t('top.mode.expert')}
        </button>
      </div>
      <button
        className="btn icon ghost"
        title={t('top.theme.tip')}
        aria-label={t('top.theme.tip')}
        onClick={() => updatePrefs({ theme: dark ? 'light' : 'dark' })}
      >
        {dark ? <IconSun /> : <IconMoon />}
      </button>
      <button
        className="btn ghost"
        style={{ padding: '0 8px' }}
        title={t('settings.lang')}
        onClick={() => updatePrefs({ lang: prefs.lang === 'de' ? 'en' : 'de' })}
      >
        {prefs.lang.toUpperCase()}
      </button>
      <button
        className="btn icon ghost"
        title={t('menu.shortcuts') + ' (F1)'}
        aria-label={t('menu.shortcuts')}
        onClick={() => openDialog({ type: 'shortcuts' })}
      >
        <IconKeyboard />
      </button>
      <button
        className="btn icon ghost"
        aria-label={t('top.menu')}
        title={t('top.menu')}
        data-testid="menu-btn"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu(menu ? null : { x: r.right - 240, y: r.bottom + 6 });
        }}
      >
        <IconMenu />
      </button>
      {menu && (
        <Floating x={menu.x} y={menu.y} className="menu-pop" onClose={() => setMenu(null)}>
          {screen === 'session' && item(<IconHome size={16} />, t('menu.home'), goHome)}
          {item(<IconSettings size={16} />, t('menu.settings'), () => openDialog({ type: 'settings' }))}
          {item(<IconKeyboard size={16} />, t('menu.shortcuts'), () => openDialog({ type: 'shortcuts' }), 'F1')}
          {expert && item(<IconLayers size={16} />, t('menu.profiles'), () => openDialog({ type: 'profiles' }))}
          <div className="msep" />
          {item(<IconSearch size={16} />, t('menu.lost'), () => openDialog({ type: 'lost' }))}
          {screen === 'session' && item(<IconTrash size={16} />, t('menu.trash'), () => openDialog({ type: 'trash' }))}
          {screen === 'session' && item(<IconChart size={16} />, t('menu.summary'), () => openDialog({ type: 'summary' }))}
          <div className="msep" />
          {item(<IconInfo size={16} />, t('menu.about'), () => openDialog({ type: 'about' }))}
        </Floating>
      )}
    </div>
  );
}
