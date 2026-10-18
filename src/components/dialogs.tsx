import { useEffect, useMemo, useState } from 'react';
import { t, LANGS } from '../i18n';
import {
  useStore, closeDialog, updatePrefs, activeProfile, setTargetKey, updateSettings, emptyTrash, goHome,
  toast, setActiveProfile, updateQuickStart, deleteQuickStart, openDialog,
} from '../store';
import type { AppInfo, Prefs, Profile } from '../types';
import { Dialog, HelpText, KeyCap, Switch } from './ui';
import { fmtBytes, fmtDuration, fmtNum, isAssignableKey, keyFromEvent, modKey, uid, basename } from '../util';
import { IconImage, IconSparkle, IconFolder, IconCheck, IconWarning } from '../icons';

export function Dialogs() {
  const d = useStore((s) => s.dialog);
  if (!d) return null;
  switch (d.type) {
    case 'settings':
      return <SettingsDialog tab={d.tab} />;
    case 'shortcuts':
      return <ShortcutsDialog />;
    case 'about':
      return <AboutDialog />;
    case 'summary':
      return <SummaryDialog />;
    case 'trash':
      return <TrashDialog />;
    case 'lost':
      return <LostDialog />;
    case 'profiles':
      return <ProfilesDialog />;
    case 'keyCapture':
      return <KeyCaptureDialog targetId={d.targetId} />;
    case 'prompt':
      return <PromptDialog title={d.title} value={d.value} onOk={d.onOk} />;
    case 'quickEdit':
      return <QuickEditDialog id={d.id} />;
  }
}

// ------------------------------------------------------------------ Einstellungen

function Row({ label, desc, help, children }: { label: string; desc?: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="setting">
      <div className="lbl">
        <div className="row" style={{ gap: 6 }}>
          {label}
          {help && <HelpText title={label} text={help} />}
        </div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

function SettingsDialog({ tab: initial }: { tab?: string }) {
  const p = useStore((s) => s.settings.prefs);
  const [tab, setTab] = useState(initial || 'general');
  const expert = p.mode === 'expert';
  const set = (x: Partial<Prefs>) => updatePrefs(x);
  const tabs = [
    ['general', t('settings.tab.general')],
    ['sorting', t('settings.tab.sorting')],
    ['trash', t('settings.tab.trash')],
    ['display', t('settings.tab.display')],
    ...(expert ? [['advanced', t('settings.tab.advanced')]] : []),
  ];
  return (
    <Dialog title={t('settings.title')} wide>
      <div className="tabs" style={{ margin: '0 -18px 6px' }}>
        {tabs.map(([id, l]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'general' && (
        <>
          <Row label={t('settings.lang')}>
            <select className="select" value={p.lang} onChange={(e) => set({ lang: e.target.value as Prefs['lang'] })}>
              {LANGS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('settings.theme')}>
            <Seg
              value={p.theme}
              onChange={(v) => set({ theme: v })}
              options={[
                ['dark', t('top.theme.dark')],
                ['light', t('top.theme.light')],
                ['system', t('settings.theme.system')],
              ]}
            />
          </Row>
          <Row label={t('settings.mode')} help={t('settings.mode.help')}>
            <Seg
              value={p.mode}
              onChange={(v) => set({ mode: v })}
              options={[
                ['simple', t('top.mode.simple')],
                ['expert', t('top.mode.expert')],
              ]}
            />
          </Row>
        </>
      )}
      {tab === 'sorting' && (
        <>
          <Row label={t('settings.transferMode')} help={t('help.mode.body')}>
            <Seg
              value={p.transferMode}
              onChange={(v) => set({ transferMode: v })}
              options={[
                ['move', t('tb.move')],
                ['copy', t('tb.copy')],
              ]}
            />
          </Row>
          <Row label={t('settings.liveVideo')} help={t('settings.liveVideo.help')}>
            <select className="select" value={p.liveVideo} onChange={(e) => set({ liveVideo: e.target.value as Prefs['liveVideo'] })}>
              <option value="move">{t('settings.liveVideo.move')}</option>
              <option value="trash">{t('settings.liveVideo.trash')}</option>
              <option value="keep">{t('settings.liveVideo.keep')}</option>
            </select>
          </Row>
          <Row label={t('settings.liveAutoplay')}>
            <Switch on={p.liveAutoplay} onChange={(v) => set({ liveAutoplay: v })} />
          </Row>
          <Row label={t('settings.recursive')}>
            <Switch on={p.recursive} onChange={(v) => set({ recursive: v })} />
          </Row>
          <Row label={t('settings.suggest')} help={t('settings.suggest.help')}>
            <Switch on={p.suggest} onChange={(v) => set({ suggest: v })} />
          </Row>
          {expert && p.suggest && (
            <Row label={t('settings.suggestWindow')}>
              <div className="row">
                <input
                  className="input"
                  type="number"
                  min={1}
                  style={{ width: 90 }}
                  value={p.suggestWindowSec}
                  onChange={(e) => set({ suggestWindowSec: Math.max(1, Number(e.target.value) || 1) })}
                />
                <span className="muted">{t('common.seconds')}</span>
              </div>
            </Row>
          )}
        </>
      )}
      {tab === 'trash' && (
        <>
          <Row label={t('settings.trashMode')} help={t('settings.trash.help')}>
            <Seg
              value={p.trashMode}
              onChange={(v) => set({ trashMode: v })}
              options={[
                ['source', t('common.default')],
                ['custom', t('start.trash.custom')],
              ]}
            />
          </Row>
          {p.trashMode === 'source' ? (
            <div className="muted small" style={{ padding: '6px 0' }}>
              {t('start.trash.default')}
            </div>
          ) : (
            <div className="pathbox" style={{ padding: '6px 0' }}>
              <div className="path small mono">{p.customTrash || '—'}</div>
              <button
                className="btn"
                onClick={async () => {
                  const d = await window.api.pickFolder({ title: t('start.trash') });
                  if (d) set({ customTrash: d });
                }}
              >
                {t('common.choose')}
              </button>
            </div>
          )}
        </>
      )}
      {tab === 'display' && (
        <>
          <Row label={t('settings.showEta')}>
            <Switch on={p.showEta} onChange={(v) => set({ showEta: v })} />
          </Row>
          <Row label={t('settings.filmstrip')}>
            <Switch on={p.showFilmstrip} onChange={(v) => set({ showFilmstrip: v })} />
          </Row>
          <Row label={t('settings.zenFlash')}>
            <Switch on={p.zenFlash} onChange={(v) => set({ zenFlash: v })} />
          </Row>
          <Row label={t('settings.thumbSize')}>
            <input
              type="range"
              min={110}
              max={320}
              step={10}
              value={p.thumbSize}
              onChange={(e) => set({ thumbSize: Number(e.target.value) })}
            />
          </Row>
        </>
      )}
      {tab === 'advanced' && <AdvancedTab />}
    </Dialog>
  );
}

function AdvancedTab() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    window.api.appInfo().then(setInfo);
  }, []);
  return (
    <>
      <Row label={t('settings.journal')} help={t('settings.journal.help')}>
        <button className="btn" disabled={!info} onClick={() => info && window.api.openPath(info.journal)}>
          {t('trash.open')}
        </button>
      </Row>
      <Row label={t('settings.dataFolder')} desc={info?.userData}>
        <button className="btn" disabled={!info} onClick={() => info && window.api.openPath(info.userData)}>
          {t('trash.open')}
        </button>
      </Row>
      <Row label={t('settings.cache')}>
        <button
          className="btn"
          onClick={async () => {
            await window.api.clearCache();
            toast('success', t('settings.cacheDone'));
          }}
        >
          {t('common.delete')}
        </button>
      </Row>
    </>
  );
}

// ------------------------------------------------------------------ Tastenübersicht

function ShortcutsDialog() {
  useStore((s) => s.settings.profiles);
  const prof = activeProfile();
  const mod = modKey();
  const mac = window.api.platform === 'darwin';
  const general: [string, string[]][] = [
    [t('keys.skip'), [t('key.space')]],
    [t('keys.delete'), mac ? ['⌫'] : [t('key.del'), '⌫']],
    [t('keys.other'), ['Enter']],
    [t('keys.undo'), [mod, 'Z']],
    [t('keys.nav'), ['←', '→']],
    [t('keys.firstLast'), [t('key.home'), t('key.end')]],
    [t('keys.toggleView'), ['Tab']],
    [t('keys.fullscreen'), mac ? ['F11', '⌃⌘F'] : ['F11']],
    [t('keys.zen'), ['F10']],
    [t('keys.esc'), ['Esc']],
    [t('keys.selectAll'), [mod, 'A']],
    [t('keys.zoom'), ['+', '−']],
    [t('keys.zoomReset'), [mod, '0']],
    [t('keys.help'), mac ? ['F1', '⌘/'] : ['F1']],
    [t('keys.quick'), ['1', '…', '9']],
  ];
  return (
    <Dialog title={t('keys.title')} wide>
      {prof.targets.length > 0 && (
        <>
          <div className="section-title">{t('keys.targets')}</div>
          <div className="keys-grid" style={{ marginBottom: 18 }}>
            {prof.targets.map((tg) => (
              <div key={tg.id} className="kr">
                <i style={{ width: 10, height: 10, borderRadius: 3, background: tg.color }} />
                <span className="ellipsis">{tg.name}</span>
                <span className="ks">
                  <KeyCap k={tg.key} />
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="section-title">{t('keys.general')}</div>
      <div className="keys-grid">
        {general.map(([label, keys]) => (
          <div key={label} className="kr">
            <span>{label}</span>
            <span className="ks">
              {keys.map((k, i) => (
                <KeyCap key={i} k={k} />
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="section-title" style={{ marginTop: 18 }}>
        {t('keys.mouse')}
      </div>
      <div className="muted" style={{ lineHeight: 1.9 }}>
        {t('keys.mouse.wheel')}
        <br />
        {t('keys.mouse.dbl')}
        <br />
        {t('keys.mouse.drag')}
        <br />
        {t('keys.mouse.swipe')}
        <br />
        {t('keys.mouse.grid', { mod })}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Über

function AboutDialog() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    window.api.appInfo().then(setInfo);
  }, []);
  const apps = [1, 2, 3] as const;
  return (
    <Dialog title={t('about.title')} wide>
      <div className="row" style={{ gap: 14, marginBottom: 14 }}>
        <div className="logo" style={{ width: 56, height: 56, borderRadius: 14 }}>
          <IconImage size={30} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{t('app.name')}</div>
          <div className="muted">{t('about.version', { v: info?.version || '…' })}</div>
          <div className="faint small">{t('app.tagline')}</div>
        </div>
      </div>
      <div className="card" style={{ padding: 12, marginBottom: 16 }}>
        <div className="row">
          <IconCheck size={16} style={{ color: 'var(--success)' }} />
          {t('about.privacy')}
        </div>
      </div>
      <div className="section-title">{t('about.more')}</div>
      <div className="apps" style={{ marginBottom: 16 }}>
        {apps.map((n) => (
          <div key={n} className="app-card">
            <div className="ic">
              <IconSparkle size={18} />
            </div>
            <div style={{ fontWeight: 600 }}>{t(`about.placeholder${n}` as const)}</div>
            <div className="small faint">{t(`about.placeholder${n}.desc` as const)}</div>
            <div className="small" style={{ color: 'var(--accent)' }}>
              {t('about.soon')}
            </div>
          </div>
        ))}
      </div>
      <div className="row small muted" style={{ justifyContent: 'space-between' }}>
        <span>{t('about.copyright', { year: new Date().getFullYear() })}</span>
        <span className="faint">
          {t('about.tech')}: Electron {info?.electron} · Chromium {info?.chrome?.split('.')[0]} · {info?.platform}
        </span>
      </div>
      <div className="small" style={{ marginTop: 8 }}>
        <a href="#" onClick={(e) => e.preventDefault()} style={{ color: 'var(--accent)' }}>
          {t('about.website')}
        </a>
        <span className="faint"> (Platzhalter)</span>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Bilanz

function SummaryDialog() {
  const s = useStore((st) => st.session);
  useStore((st) => st.settings.profiles);
  if (!s) return null;
  const prof = activeProfile();
  const finished = s.done.size >= s.items.length;
  const dur = Date.now() - s.startedAt;
  const handled = s.sorted + s.deleted + s.other;
  const perMin = dur > 0 ? handled / (dur / 60000) : 0;
  const rows = prof.targets
    .map((tg) => ({ tg, n: s.counts[tg.id] || 0 }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...rows.map((r) => r.n), s.deleted);
  return (
    <Dialog
      title={t('summary.title')}
      footer={
        <>
          {s.deleted > 0 && (
            <button className="btn" onClick={() => openDialog({ type: 'trash' })}>
              {t('summary.emptyTrash')}
            </button>
          )}
          <div className="grow" />
          {!finished && (
            <button className="btn" onClick={closeDialog}>
              {t('summary.continue')}
            </button>
          )}
          <button className="btn primary" onClick={goHome}>
            {t('summary.home')}
          </button>
        </>
      }
    >
      <div data-testid="summary">
        {finished && (
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>🎉 {t('summary.finished')}</div>
        )}
        <div className="stats" style={{ marginBottom: 16 }}>
          <div className="stat">
            <div className="v">{fmtDuration(dur)}</div>
            <div className="l">{t('summary.duration')}</div>
          </div>
          <div className="stat">
            <div className="v">{fmtNum(Math.round(perMin))}</div>
            <div className="l">{t('summary.speed')} · {t('summary.perMin', { n: '' }).trim()}</div>
          </div>
          <div className="stat">
            <div className="v">{fmtNum(s.sorted + s.other)}</div>
            <div className="l">{t('summary.sorted')}</div>
          </div>
          <div className="stat">
            <div className="v">{fmtNum(s.deleted)}</div>
            <div className="l">{t('summary.deleted')}</div>
          </div>
          <div className="stat">
            <div className="v">{fmtNum([...s.skipped].filter((id) => !s.done.has(id)).length)}</div>
            <div className="l">{t('summary.skipped')}</div>
          </div>
          <div className="stat">
            <div className="v">0</div>
            <div className="l">{t('summary.series')}</div>
          </div>
        </div>
        {(rows.length > 0 || s.deleted > 0) && (
          <>
            <div className="section-title">{t('summary.perTarget')}</div>
            <div className="bars">
              {rows.map(({ tg, n }) => (
                <div key={tg.id} className="br">
                  <span className="ellipsis">{tg.name}</span>
                  <div className="track">
                    <div style={{ width: `${(n / max) * 100}%`, background: tg.color }} />
                  </div>
                  <span className="small muted" style={{ textAlign: 'right' }}>
                    {fmtNum(n)}
                  </span>
                </div>
              ))}
              {s.deleted > 0 && (
                <div className="br">
                  <span>{t('summary.deleted')}</span>
                  <div className="track">
                    <div style={{ width: `${(s.deleted / max) * 100}%`, background: 'var(--danger)' }} />
                  </div>
                  <span className="small muted" style={{ textAlign: 'right' }}>
                    {fmtNum(s.deleted)}
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Löschordner

function TrashDialog() {
  const [info, setInfo] = useState<{ dir: string; count: number; bytes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    window.api.trashInfo().then(setInfo);
  }, []);
  return (
    <Dialog
      title={t('trash.title')}
      footer={
        <>
          {info && (
            <button className="btn" onClick={() => window.api.openPath(info.dir)} disabled={!info.count}>
              <IconFolder size={16} />
              {t('trash.open')}
            </button>
          )}
          <div className="grow" />
          <button className="btn" onClick={closeDialog}>
            {t('common.cancel')}
          </button>
          <button
            className="btn danger solid"
            disabled={!info || !info.count || busy}
            data-testid="trash-confirm"
            onClick={async () => {
              setBusy(true);
              await emptyTrash();
              setBusy(false);
              closeDialog();
            }}
          >
            {t('trash.empty')}
          </button>
        </>
      }
    >
      {!info ? (
        <div className="spinner" />
      ) : info.count === 0 ? (
        <div className="muted">{t('trash.isEmpty')}</div>
      ) : (
        <>
          <p>{t('trash.info', { n: fmtNum(info.count), size: fmtBytes(info.bytes) })}</p>
          <p className="mono small muted">{info.dir}</p>
          <p className="row" style={{ color: 'var(--danger)' }}>
            <IconWarning size={16} />
            {t('trash.warn')}
          </p>
        </>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------ Verlorene Ordner

function LostDialog() {
  const settings = useStore((s) => s.settings);
  const reach = useStore((s) => s.reach);
  const [results, setResults] = useState<Record<string, string[]> | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const missing = useMemo(() => {
    const set = new Set<string>();
    for (const p of settings.profiles) for (const tg of p.targets) if (reach[tg.path] === false) set.add(tg.path);
    return [...set];
  }, [settings, reach]);

  const relink = (from: string, to: string) => {
    updateSettings((s) => ({
      ...s,
      profiles: s.profiles.map((p) => ({
        ...p,
        targets: p.targets.map((tg) => (tg.path === from ? { ...tg, path: to } : tg)),
      })),
    }));
    toast('success', t('toast.relinked', { name: basename(to) }));
  };

  const search = async () => {
    setBusy(true);
    const hints = settings.profiles.flatMap((p) => p.targets.map((tg) => tg.path)).filter((x) => reach[x]);
    const r = await window.api.findLost({ missing, hints });
    setResults(r);
    const c: Record<string, string> = {};
    for (const m of missing) if (r[m]?.[0]) c[m] = r[m][0];
    setChoice(c);
    setBusy(false);
  };

  return (
    <Dialog
      title={t('lost.title')}
      wide
      footer={
        <>
          <button className="btn" onClick={() => window.api.checkReach().then((r) => useStore.setState({ reach: { ...reach, ...r } }))}>
            {t('lost.recheck')}
          </button>
          <div className="grow" />
          {missing.length > 0 && (
            <button className="btn primary" onClick={search} disabled={busy}>
              {busy ? t('lost.searching') : t('common.search')}
            </button>
          )}
        </>
      }
    >
      {missing.length === 0 ? (
        <div className="muted">{t('lost.none')}</div>
      ) : (
        <>
          <p className="muted">{t('lost.intro')}</p>
          {missing.map((m) => (
            <div key={m} className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="row">
                <IconWarning size={16} style={{ color: 'var(--danger)' }} />
                <span className="mono small ellipsis grow">{m}</span>
                <button
                  className="btn"
                  onClick={async () => {
                    const d = await window.api.pickFolder({ title: basename(m) });
                    if (d) relink(m, d);
                  }}
                >
                  {t('lost.manual')}
                </button>
              </div>
              {results && (
                <div style={{ paddingLeft: 24, marginTop: 6 }}>
                  {(results[m] || []).length === 0 ? (
                    <div className="small faint">{t('lost.noMatch')}</div>
                  ) : (
                    <>
                      {results[m].slice(0, 6).map((c) => (
                        <label key={c} className="row small" style={{ padding: '3px 0', cursor: 'pointer' }}>
                          <input type="radio" name={m} checked={choice[m] === c} onChange={() => setChoice({ ...choice, [m]: c })} />
                          <span className="mono ellipsis">{c}</span>
                        </label>
                      ))}
                      <button className="btn primary" style={{ marginTop: 6 }} disabled={!choice[m]} onClick={() => relink(m, choice[m])}>
                        {t('lost.relink')}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------ Profile

function ProfilesDialog() {
  const settings = useStore((s) => s.settings);
  const active = activeProfile();
  const add = (p: Profile) => {
    updateSettings((s) => ({ ...s, profiles: [...s.profiles, p] }));
    setActiveProfile(p.id);
  };
  return (
    <Dialog
      title={t('profiles.title')}
      footer={
        <button className="btn primary" onClick={() => add({ id: uid('p'), name: t('profiles.newName'), targets: [], groups: [] })}>
          {t('profiles.new')}
        </button>
      }
    >
      <p className="muted small">{t('profiles.help')}</p>
      {settings.profiles.map((p) => (
        <div key={p.id} className={`list-row ${p.id === active.id ? 'on' : ''}`}>
          <input type="radio" checked={p.id === active.id} onChange={() => setActiveProfile(p.id)} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }} className="ellipsis">
              {p.name}
            </div>
            <div className="small faint row" style={{ gap: 4, flexWrap: 'wrap' }}>
              {t('profiles.targets', { n: p.targets.length })}
              {p.targets.slice(0, 8).map((tg) => (
                <KeyCap key={tg.id} k={tg.key} />
              ))}
            </div>
          </div>
          <button
            className="btn ghost"
            onClick={() =>
              openDialog({
                type: 'prompt',
                title: t('common.rename'),
                value: p.name,
                onOk: (v) => {
                  updateSettings((s) => ({ ...s, profiles: s.profiles.map((x) => (x.id === p.id ? { ...x, name: v } : x)) }));
                  openDialog({ type: 'profiles' });
                },
              })
            }
          >
            {t('common.rename')}
          </button>
          <button
            className="btn ghost"
            onClick={() =>
              add({
                ...structuredClone(p),
                id: uid('p'),
                name: t('profiles.copyOf', { name: p.name }),
                targets: p.targets.map((x) => ({ ...x, id: uid('tg') })),
              })
            }
          >
            {t('profiles.duplicate')}
          </button>
          <button
            className="btn ghost danger"
            disabled={settings.profiles.length < 2}
            onClick={async () => {
              const r = await window.api.confirm({
                message: t('profiles.confirmDelete', { name: p.name }),
                buttons: [t('common.delete'), t('common.cancel')],
                type: 'warning',
              });
              if (r !== 0) return;
              const rest = settings.profiles.filter((x) => x.id !== p.id);
              updateSettings((s) => ({ ...s, profiles: rest }));
              if (p.id === active.id) setActiveProfile(rest[0].id);
            }}
          >
            {t('common.delete')}
          </button>
        </div>
      ))}
    </Dialog>
  );
}

// ------------------------------------------------------------------ Taste festlegen

function KeyCaptureDialog({ targetId }: { targetId: string }) {
  useStore((s) => s.settings.profiles);
  const prof = activeProfile();
  const tg = prof.targets.find((x) => x.id === targetId);
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return; // schließt über die globale Steuerung
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        setTargetKey(targetId, '');
        closeDialog();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = keyFromEvent(e);
      if (!k || !isAssignableKey(k)) return;
      const other = prof.targets.find((x) => x.key === k && x.id !== targetId);
      if (other && pending !== k) {
        setPending(k);
        return;
      }
      setTargetKey(targetId, k);
      closeDialog();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [targetId, prof, pending]);
  if (!tg) return null;
  const other = pending ? prof.targets.find((x) => x.key === pending && x.id !== targetId) : null;
  return (
    <Dialog title={t('targets.menu.key')}>
      <div className="keycap-capture" data-testid="key-capture">
        <div>{t('targets.keyPrompt', { name: tg.name })}</div>
        <KeyCap k={pending || tg.key} className="big" />
        {other ? (
          <div style={{ color: 'var(--warn)' }}>
            {t('targets.keyTaken', { key: pending!, name: other.name })}
            <div className="small muted">↵ {pending}</div>
          </div>
        ) : (
          <div className="small faint">{t('targets.keyAllowed')}</div>
        )}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Eingabe

function PromptDialog({ title, value, onOk }: { title: string; value: string; onOk: (v: string) => void }) {
  const [v, setV] = useState(value);
  const ok = () => {
    if (!v.trim()) return;
    closeDialog();
    onOk(v.trim());
  };
  return (
    <Dialog
      title={title}
      footer={
        <>
          <button className="btn" onClick={closeDialog}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={ok} data-testid="prompt-ok">
            {t('common.ok')}
          </button>
        </>
      }
    >
      <input
        className="input"
        style={{ width: '100%' }}
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && ok()}
        onFocus={(e) => e.currentTarget.select()}
      />
    </Dialog>
  );
}

// ------------------------------------------------------------------ Schnellstart bearbeiten

function QuickEditDialog({ id }: { id: string }) {
  const settings = useStore((s) => s.settings);
  const q = settings.quickStarts.find((x) => x.id === id);
  if (!q) return null;
  const up = (patch: Parameters<typeof updateQuickStart>[1]) => updateQuickStart(id, patch);
  return (
    <Dialog
      title={t('quick.edit')}
      footer={
        <>
          <button
            className="btn danger"
            onClick={() => {
              deleteQuickStart(id);
              closeDialog();
            }}
          >
            {t('quick.delete')}
          </button>
          <div className="grow" />
          <button className="btn primary" onClick={closeDialog}>
            {t('common.ok')}
          </button>
        </>
      }
    >
      <div className="form" style={{ gridTemplateColumns: '150px 1fr' }}>
        <label>{t('quick.name')}</label>
        <input className="input" value={q.name} onChange={(e) => up({ name: e.target.value })} />
        <label>{t('start.source')}</label>
        <div className="pathbox">
          <div className="path small mono">{q.source}</div>
          <button
            className="btn"
            onClick={async () => {
              const d = await window.api.pickFolder({ defaultPath: q.source });
              if (d) up({ source: d });
            }}
          >
            {t('common.choose')}
          </button>
        </div>
        <label>{t('start.profile')}</label>
        <select className="select" value={q.profileId} onChange={(e) => up({ profileId: e.target.value })}>
          {settings.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label>{t('start.trash')}</label>
        <div className="pathbox">
          <div className="path small">{q.trashDir || t('start.trash.default')}</div>
          <button
            className="btn"
            onClick={async () => {
              const d = await window.api.pickFolder({ title: t('start.trash') });
              if (d) up({ trashDir: d });
            }}
          >
            {t('common.choose')}
          </button>
          {q.trashDir && (
            <button className="btn ghost" onClick={() => up({ trashDir: null })}>
              {t('common.default')}
            </button>
          )}
        </div>
        <label>{t('start.view')}</label>
        <div>
          <Seg
            value={q.startView}
            onChange={(v) => up({ startView: v })}
            options={[
              ['grid', t('start.view.grid')],
              ['single', t('start.view.single')],
            ]}
          />
        </div>
        <label>{t('start.recursive')}</label>
        <div>
          <Switch on={q.recursive} onChange={(v) => up({ recursive: v })} />
        </div>
        <label>{t('start.fullscreen')}</label>
        <div>
          <Switch on={q.fullscreen} onChange={(v) => up({ fullscreen: v })} />
        </div>
      </div>
    </Dialog>
  );
}

