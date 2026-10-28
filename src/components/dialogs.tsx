import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n';
import {
  useStore, closeDialog, activeProfile, setTargetKey, updateSettings, emptyTrash, goHome, toast, openDialog,
} from '../store';
import { Dialog, KeyCap, Spinner } from './ui';
import { SettingsDialog } from './Settings';
import { PeopleDialog } from './PeopleDialog';
import { IllDone } from './illustrations';
import { fmtBytes, fmtDuration, fmtNum, isAssignableKey, keyFromEvent, basename } from '../util';
import { IconFolder, IconWarning, IconTrash, IconSearch, IconInfo } from '../icons';

export function Dialogs() {
  const d = useStore((s) => s.dialog);
  if (!d) return null;
  switch (d.type) {
    case 'settings':
      return <SettingsDialog tab={d.tab} />;
    case 'shortcuts':
      return <SettingsDialog tab="help" />;
    case 'about':
      return <SettingsDialog tab="about" />;
    case 'profiles':
      return <SettingsDialog tab="sets" />;
    case 'summary':
      return <SummaryDialog />;
    case 'trash':
      return <TrashDialog />;
    case 'lost':
      return <LostDialog />;
    case 'keyCapture':
      return <KeyCaptureDialog targetId={d.targetId} />;
    case 'people':
      return <PeopleDialog />;
    case 'prompt':
      return <PromptDialog title={d.title} value={d.value} onOk={d.onOk} />;
    default:
      return null;
  }
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
  const skipped = [...s.skipped].filter((id) => !s.done.has(id)).length;
  return (
    <Dialog
      title={finished ? t('summary.finished') : t('summary.title')}
      size="wide"
      testId="summary"
      footer={
        <>
          {s.deleted > 0 && (
            <button className="btn" onClick={() => openDialog({ type: 'trash' })}>
              <IconTrash size={15} />
              {t('summary.emptyTrash')}
            </button>
          )}
          <span className="spacer" />
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
      {finished && (
        <div className="row" style={{ gap: 16, marginBottom: 18 }}>
          <IllDone />
          <div className="muted" style={{ fontSize: 15 }}>
            {t('summary.finishedText', { n: fmtNum(handled) })}
          </div>
        </div>
      )}
      <div className="stats" style={{ marginBottom: 20 }}>
        <div className="stat">
          <div className="v">{fmtNum(s.sorted + s.other)}</div>
          <div className="l">{t('summary.sorted')}</div>
        </div>
        <div className="stat">
          <div className="v">{fmtNum(s.deleted)}</div>
          <div className="l">{t('summary.deleted')}</div>
        </div>
        <div className="stat">
          <div className="v">{fmtNum(skipped)}</div>
          <div className="l">{t('summary.skipped')}</div>
        </div>
        <div className="stat">
          <div className="v">{fmtDuration(dur)}</div>
          <div className="l">{t('summary.duration')}</div>
        </div>
        <div className="stat">
          <div className="v">{fmtNum(Math.round(perMin))}</div>
          <div className="l">{t('summary.speed')}</div>
        </div>
        <div className="stat">
          <div className="v">{fmtNum(s.seriesCompared)}</div>
          <div className="l">{t('summary.series')}</div>
        </div>
      </div>
      {(rows.length > 0 || s.deleted > 0) && (
        <>
          <div className="section-label">{t('summary.perTarget')}</div>
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
    </Dialog>
  );
}

// ------------------------------------------------------------------ Papierkorb

function TrashDialog() {
  const [info, setInfo] = useState<{ dir: string; count: number; bytes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const sysTrash = useStore((s) => s.settings.prefs.emptyToSystemTrash);
  useEffect(() => {
    window.api.trashInfo().then(setInfo);
  }, []);
  return (
    <Dialog
      title={t('trash.title')}
      icon={<IconTrash size={20} style={{ color: 'var(--danger)' }} />}
      footer={
        <>
          {info && info.count > 0 && (
            <button className="btn" onClick={() => window.api.openPath(info.dir)}>
              <IconFolder size={15} />
              {t('trash.open')}
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={closeDialog}>
            {t('common.cancel')}
          </button>
          <button
            className="btn danger-solid"
            disabled={!info || !info.count || busy}
            data-testid="trash-confirm"
            onClick={async () => {
              setBusy(true);
              await emptyTrash();
              setBusy(false);
              closeDialog();
            }}
          >
            {sysTrash ? t('trash.emptySystem') : t('trash.empty')}
          </button>
        </>
      }
    >
      {!info ? (
        <Spinner />
      ) : info.count === 0 ? (
        <p className="muted">{t('trash.isEmpty')}</p>
      ) : (
        <>
          <p style={{ fontSize: 15, marginTop: 0 }}>{t('trash.info', { n: fmtNum(info.count), size: fmtBytes(info.bytes) })}</p>
          <p className="mono faint">{info.dir}</p>
          {sysTrash ? (
            <div className="row" style={{ padding: 12, borderRadius: 12, background: 'var(--accent-soft)', alignItems: 'flex-start' }}>
              <IconInfo size={17} style={{ flex: 'none', marginTop: 1, color: 'var(--accent)' }} />
              {t(window.api.platform === 'darwin' ? 'trash.systemInfoMac' : 'trash.systemInfo')}
            </div>
          ) : (
            <div className="row" style={{ padding: 12, borderRadius: 12, background: 'var(--danger-soft)', color: 'var(--danger)', alignItems: 'flex-start' }}>
              <IconWarning size={17} style={{ flex: 'none', marginTop: 1 }} />
              {t('trash.warn')}
            </div>
          )}
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
      profiles: s.profiles.map((p) => ({ ...p, targets: p.targets.map((tg) => (tg.path === from ? { ...tg, path: to } : tg)) })),
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
      size="wide"
      icon={<IconSearch size={20} />}
      footer={
        <>
          <button className="btn" onClick={() => window.api.checkReach().then((r) => useStore.setState({ reach: { ...reach, ...r } }))}>
            {t('lost.recheck')}
          </button>
          <span className="spacer" />
          {missing.length > 0 && (
            <button className="btn primary" onClick={search} disabled={busy}>
              {busy ? <Spinner small /> : <IconSearch size={15} />}
              {busy ? t('lost.searching') : t('lost.search')}
            </button>
          )}
        </>
      }
    >
      {missing.length === 0 ? (
        <p className="muted">{t('lost.none')}</p>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            {t('lost.intro')}
          </p>
          <div className="card">
            {missing.map((m) => (
              <div key={m} className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div className="row">
                  <IconWarning size={16} style={{ color: 'var(--danger)' }} />
                  <span className="mono ellipsis grow">{m}</span>
                  <button
                    className="btn sm"
                    onClick={async () => {
                      const d = await window.api.pickFolder({ title: basename(m) });
                      if (d) relink(m, d);
                    }}
                  >
                    {t('lost.manual')}
                  </button>
                </div>
                {results && (
                  <div style={{ paddingLeft: 26, marginTop: 8 }}>
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
                        <button className="btn primary sm" style={{ marginTop: 6 }} disabled={!choice[m]} onClick={() => relink(m, choice[m])}>
                          {t('lost.relink')}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
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
      <div className="key-capture" data-testid="key-capture">
        <div style={{ fontSize: 15 }}>{t('targets.keyPrompt', { name: tg.name })}</div>
        <KeyCap k={pending || tg.key} size="xl" />
        {other ? (
          <div style={{ color: 'var(--warn)' }}>{t('targets.keyTaken', { key: pending!, name: other.name })}</div>
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
