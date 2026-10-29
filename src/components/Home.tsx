import { useEffect, useState } from 'react';
import { t } from '../i18n';
import {
  useStore, beginSetup, pickSetupSource, runQuickStart, sortedRecents, forgetRecent, togglePinRecent, openDialog,
  updateQuickStart, sourcesOf, isExpert,
} from '../store';
import type { QuickStart } from '../types';
import { KeyCap, MenuPopup, useMenu } from './ui';
import { IconFolder, IconFolderPlus, IconLock, IconMore, IconPin, IconWarning, IconArrowRight } from '../icons';
import { basename } from '../util';
import { NEWS_ID } from './NewsDialog';

export function Home() {
  const quick = useStore((s) => s.settings.quickStarts);
  const reach = useStore((s) => s.reach);
  const [drag, setDrag] = useState(false);
  const recents = sortedRecents(quick);
  // Neue Funktionen einmal vorstellen (wer die App schon kennt)
  useEffect(() => {
    const st = useStore.getState();
    // (nicht bei automatischen Tests – navigator.webdriver)
    if (st.settings.tutorialDone && st.settings.newsSeen !== NEWS_ID && !st.dialog && !navigator.webdriver) {
      const timer = setTimeout(() => !useStore.getState().dialog && openDialog({ type: 'news' }), 600);
      return () => clearTimeout(timer);
    }
  }, []);

  // Ordner (oder Fotos) aus dem Explorer/Finder hineinziehen – bei Dateien zählt ihr Ordner
  useEffect(
    () =>
      window.api.onFileDrop(async (e) => {
        if (e.type === 'enter') setDrag(true);
        else if (e.type === 'leave') setDrag(false);
        else {
          setDrag(false);
          const dirs: string[] = [];
          for (const p of e.paths) {
            const r = await window.api.checkDir(p);
            const d = r.ok || r.code !== 'ENOTDIR' ? p : await window.api.parentDir(p);
            if (!dirs.includes(d)) dirs.push(d);
          }
          if (dirs.length) beginSetup(dirs);
        }
      }),
    []
  );

  return (
    <div className="screen" data-testid="home">
      <div className="center-col">
        <div className="home-hero">
          <h1>{t('home.title')}</h1>
          <p>{t('home.sub')}</p>
        </div>

        <div className={`dropzone ${drag ? 'drag' : ''}`}>
          <div className="dz-icon">
            <IconFolderPlus size={30} />
          </div>
          <button className="btn primary xl" onClick={pickSetupSource} data-testid="pick-source">
            <IconFolder size={19} />
            {t('home.pick')}
          </button>
          <div className="dz-hint">{t('home.drop')}</div>
        </div>

        {recents.length === 0 && (
          <div className="how" data-testid="how">
            {[1, 2, 3].map((n) => (
              <div key={n} className="how-step">
                <span className="num">{n}</span>
                <div>
                  <div className="how-title">{t(`onb.tour.${n}.title` as 'onb.tour.1.title')}</div>
                  <div className="how-text">{t(`onb.tour.${n}.text` as 'onb.tour.1.text')}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {recents.length > 0 && (
          <div style={{ marginTop: 36 }}>
            <div className="section-label">{t('home.recent')}</div>
            <div className="recent-grid" data-testid="recents">
              {recents.map((q, i) => (
                <RecentCard key={q.id} q={q} index={i} offline={reach[q.source] === false} />
              ))}
            </div>
            {recents.length > 1 && isExpert() && (
              <div className="faint small" style={{ marginTop: 12 }}>
                {t('home.keyHint')}
              </div>
            )}
          </div>
        )}

        <div className="privacy">
          <IconLock size={14} />
          {t('home.privacy')}
        </div>
      </div>
    </div>
  );
}

function RecentCard({ q, index, offline }: { q: QuickStart; index: number; offline: boolean }) {
  const profiles = useStore((s) => s.settings.profiles);
  const prof = profiles.find((p) => p.id === q.profileId);
  const menu = useMenu();
  return (
    <div
      className="recent"
      role="button"
      tabIndex={0}
      data-testid="recent"
      onClick={() => runQuickStart(q)}
      onKeyDown={(e) => e.key === 'Enter' && runQuickStart(q)}
    >
      <div className="row" style={{ gap: 12 }} title={t('home.continue')}>
        <div className="r-icon">
          <IconFolder size={20} />
        </div>
        <div className="grow">
          <div className="r-title ellipsis">
            {q.pinned && <IconPin size={13} style={{ marginRight: 4, verticalAlign: -1, opacity: 0.6 }} />}
            {q.name || basename(q.source)}
          </div>
          <div className="r-path ellipsis">{sourcesOf(q).join(' · ')}</div>
        </div>
      </div>
      <div className="r-foot">
        {offline ? (
          <span className="badge danger">
            <IconWarning size={12} />
            {t('home.offline')}
          </span>
        ) : (
          <>
            <div className="r-dots">
              {(prof?.targets || []).slice(0, 7).map((tg) => (
                <span key={tg.id} className="dot" style={{ background: tg.color, width: 8, height: 8 }} />
              ))}
            </div>
            <span className="faint small">{t('home.folders', { n: prof?.targets.length || 0 })}</span>
          </>
        )}
        <span className="spacer" />
        {index < 9 && <KeyCap k={String(index + 1)} title={t('home.keyHint')} />}
        <IconArrowRight size={16} style={{ color: 'var(--accent)' }} />
      </div>
      <button
        className={`btn icon ghost sm r-menu ${menu.at ? 'open' : ''}`}
        aria-label={t('common.more')}
        onClick={(e) => {
          e.stopPropagation();
          menu.open(e, 'right', 220);
        }}
      >
        <IconMore size={16} />
      </button>
      <div onClick={(e) => e.stopPropagation()}>
        <MenuPopup at={menu.at} onClose={menu.close}>
          <button className="mi" onClick={() => beginSetup(sourcesOf(q))}>
            {t('home.edit')}
          </button>
          <button
            className="mi"
            onClick={() =>
              openDialog({
                type: 'prompt',
                title: t('common.rename'),
                value: q.name || basename(q.source),
                onOk: (v) => updateQuickStart(q.id, { name: v }),
              })
            }
          >
            {t('common.rename')}
          </button>
          <button className="mi" onClick={() => togglePinRecent(q.id)}>
            {q.pinned ? t('home.unpin') : t('home.pin')}
          </button>
          <div className="sep" />
          <button className="mi danger" onClick={() => forgetRecent(q.id)}>
            {t('home.forget')}
          </button>
        </MenuPopup>
      </div>
    </div>
  );
}
