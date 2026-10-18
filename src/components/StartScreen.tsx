import { useEffect, useState } from 'react';
import { t } from '../i18n';
import {
  useStore, startSession, saveQuickStart, runQuickStart, openDialog, updatePrefs, resolveTrashDir,
} from '../store';
import { IconFolder, IconSettings, IconWarning, IconLayers } from '../icons';
import { Help, KeyCap, Switch } from './ui';
import { basename } from '../util';
import type { QuickStart } from '../types';

export function StartScreen() {
  const settings = useStore((s) => s.settings);
  const reach = useStore((s) => s.reach);
  const p = settings.prefs;
  const expert = p.mode === 'expert';
  const [source, setSource] = useState<string>('');
  const [profileId, setProfileId] = useState(p.activeProfileId);
  const [trashCustom, setTrashCustom] = useState<string>(p.trashMode === 'custom' ? p.customTrash : '');
  const [startView, setStartView] = useState<'grid' | 'single'>('single');
  const [recursive, setRecursive] = useState(p.recursive);
  const [fullscreen, setFullscreen] = useState(false);
  const [drag, setDrag] = useState(false);

  useEffect(() => setProfileId(p.activeProfileId), [p.activeProfileId]);

  const pick = async () => {
    const dir = await window.api.pickFolder({ title: t('start.pick') });
    if (dir) setSource(dir);
  };

  const opts = () => ({
    source,
    profileId,
    trashDir: trashCustom || resolveTrashDir(source),
    startView,
    recursive,
    fullscreen,
  });

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const path = window.api.pathForFile(f);
    if (path) setSource(path);
  };

  const quick = settings.quickStarts;

  return (
    <div className="start" data-testid="start">
      <div className="start-inner">
        <div
          className={`hero ${drag ? 'drag' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
        >
          <div className="row">
            <h1>{t('start.title')}</h1>
            <Help topic="start" />
          </div>
          <div className="muted">{t('app.tagline')}</div>
          <button className="btn primary big" onClick={pick} data-testid="pick-source">
            <IconFolder size={20} />
            {t('start.pick')}
          </button>
          <div className="faint small">{t('start.drop')}</div>
        </div>

        {(source || quick.length === 0) && (
          <div className="card" data-testid="setup">
            <div className="section-title">{t('start.setup')}</div>
            <div className="form">
              <label>{t('start.source')}</label>
              <div className="pathbox">
                <div className="path mono small" title={source}>
                  {source || '—'}
                </div>
                <button className="btn" onClick={pick}>
                  {t('common.choose')}
                </button>
              </div>

              <label>{t('start.profile')}</label>
              <div className="row">
                <select
                  className="select"
                  value={profileId}
                  onChange={(e) => {
                    setProfileId(e.target.value);
                    updatePrefs({ activeProfileId: e.target.value });
                  }}
                >
                  {settings.profiles.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.name} ({t('profiles.targets', { n: pr.targets.length })})
                    </option>
                  ))}
                </select>
                {expert && (
                  <button className="btn icon ghost" title={t('menu.profiles')} onClick={() => openDialog({ type: 'profiles' })}>
                    <IconLayers />
                  </button>
                )}
                <Help topic="profile" />
              </div>

              {expert && (
                <>
                  <label className="row">
                    {t('start.trash')} <Help topic="trash" />
                  </label>
                  <div className="pathbox">
                    <div className="path small" title={trashCustom}>
                      {trashCustom || t('start.trash.default')}
                    </div>
                    <button
                      className="btn"
                      onClick={async () => {
                        const d = await window.api.pickFolder({ title: t('start.trash') });
                        if (d) setTrashCustom(d);
                      }}
                    >
                      {t('common.choose')}
                    </button>
                    {trashCustom && (
                      <button className="btn ghost" onClick={() => setTrashCustom('')}>
                        {t('common.default')}
                      </button>
                    )}
                  </div>
                </>
              )}

              <label className="row">
                {t('start.view')} <Help topic="view" />
              </label>
              <div>
                <div className="seg">
                  <button className={startView === 'grid' ? 'on' : ''} onClick={() => setStartView('grid')}>
                    {t('start.view.grid')}
                  </button>
                  <button className={startView === 'single' ? 'on' : ''} onClick={() => setStartView('single')}>
                    {t('start.view.single')}
                  </button>
                </div>
              </div>

              <label>{t('start.recursive')}</label>
              <div>
                <Switch on={recursive} onChange={setRecursive} label={t('start.recursive')} />
              </div>

              {expert && (
                <>
                  <label>{t('start.fullscreen')}</label>
                  <div>
                    <Switch on={fullscreen} onChange={setFullscreen} label={t('start.fullscreen')} />
                  </div>
                </>
              )}
            </div>
            <div className="row" style={{ marginTop: 18 }}>
              <button
                className="btn primary big"
                disabled={!source}
                onClick={() => startSession(opts())}
                data-testid="start-go"
              >
                {t('start.go')}
              </button>
              <button
                className="btn"
                disabled={!source}
                onClick={() => {
                  const prof = settings.profiles.find((x) => x.id === profileId);
                  saveQuickStart({
                    ...opts(),
                    fullscreen: true,
                    name: `${basename(source)}${prof ? ' · ' + prof.name : ''}`,
                  });
                }}
              >
                {t('start.saveQuick')}
              </button>
            </div>
          </div>
        )}

        <div>
          <div className="section-title">
            {t('start.quick')} <Help topic="quick" />
          </div>
          {quick.length === 0 ? (
            <div className="faint">{t('start.quick.empty')}</div>
          ) : (
            <div className="tiles" data-testid="quick-tiles">
              {quick.map((q, i) => (
                <QuickTile key={q.id} q={q} index={i} offline={reach[q.source] === false} />
              ))}
            </div>
          )}
        </div>

        {settings.recentSources.length > 0 && (
          <div>
            <div className="section-title">{t('start.recent')}</div>
            <div className="recent">
              {settings.recentSources.map((r) => (
                <button key={r} className="chip" title={r} onClick={() => setSource(r)}>
                  <IconFolder size={15} />
                  <span className="ellipsis">{basename(r)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="faint small" style={{ textAlign: 'center' }}>
          {t('start.privacy')}
        </div>
      </div>
    </div>
  );
}

function QuickTile({ q, index, offline }: { q: QuickStart; index: number; offline: boolean }) {
  const profiles = useStore((s) => s.settings.profiles);
  const prof = profiles.find((p) => p.id === q.profileId);
  return (
    <div
      className={`tile ${offline ? 'offline' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => runQuickStart(q)}
      onKeyDown={(e) => e.key === 'Enter' && runQuickStart(q)}
      data-testid="quick-tile"
    >
      {index < 9 && <KeyCap k={String(index + 1)} className="num" />}
      <div className="title ellipsis">{q.name}</div>
      <div className="small muted ellipsis mono" title={q.source}>
        {q.source}
      </div>
      <div className="small faint row" style={{ gap: 10 }}>
        <span className="row" style={{ gap: 4 }}>
          <IconLayers size={13} />
          {prof?.name || '—'}
        </span>
        <span>{q.startView === 'grid' ? t('start.view.grid') : t('start.view.single')}</span>
        {offline && (
          <span className="row" style={{ gap: 4, color: 'var(--danger)' }}>
            <IconWarning size={13} />
            {t('quick.offline')}
          </span>
        )}
      </div>
      <button
        className="btn icon ghost edit"
        title={t('quick.edit')}
        onClick={(e) => {
          e.stopPropagation();
          openDialog({ type: 'quickEdit', id: q.id });
        }}
      >
        <IconSettings size={16} />
      </button>
    </div>
  );
}

