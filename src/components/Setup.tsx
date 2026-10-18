import { useEffect, useState } from 'react';
import { t } from '../i18n';
import {
  useStore, updateSetup, pickSetupSource, startFromSetup, goHome, activeProfile, updateTarget, removeTarget,
  openDialog, pickAndAddTarget, createTargetFolder, setActiveProfile, updateSettings, updatePrefs, addSetupSource,
  removeSetupSource,
} from '../store';
import { tip } from './Tooltip';
import { Help, KeyCap, Switch, Spinner, MenuPopup, useMenu } from './ui';
import { IllEmptyTargets, IllGrid, IllSingle } from './illustrations';
import {
  IconFolder, IconFolderPlus, IconClose, IconArrowLeft, IconArrowRight, IconChevronDown, IconChevronRight,
  IconCheck, IconImage, IconLayers, IconPlus,
} from '../icons';
import { basename, COLORS, fmtNum, thumbUrl, uid, countLabel } from '../util';

export function SetupStepper() {
  const step = useStore((s) => s.setup?.step ?? 0);
  const labels = [t('setup.step.source'), t('setup.step.targets'), t('setup.step.start')];
  return (
    <div className="stepper">
      {labels.map((l, i) => (
        <div key={i} className="row" style={{ gap: 10 }}>
          {i > 0 && <span className="bar" />}
          <span className={`st ${i === step ? 'on' : i < step ? 'done' : ''}`}>
            <i>{i < step ? <IconCheck size={12} strokeWidth={3} /> : i + 1}</i>
            {l}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Setup() {
  const st = useStore((s) => s.setup)!;
  useStore((s) => s.settings.profiles);
  const targets = activeProfile().targets;
  const canNext = st.step === 0 ? !!st.count && st.count.total > 0 : true;

  const next = () => {
    if (st.step < 2) updateSetup({ step: (st.step + 1) as 1 | 2 });
    else startFromSetup();
  };
  const back = () => (st.step > 0 ? updateSetup({ step: (st.step - 1) as 0 | 1 }) : goHome());

  // Enter = weiter (praktisch für Tastatur-Nutzer)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === 'Enter' && tag !== 'INPUT' && tag !== 'BUTTON' && canNext && !useStore.getState().dialog) next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="setup" data-testid="setup">
      <div className="setup-body">
        <div className="setup-inner" key={st.step}>
          {st.step === 0 && <StepSource />}
          {st.step === 1 && <StepTargets />}
          {st.step === 2 && <StepStart />}
        </div>
      </div>
      <div className="setup-foot">
        <div className="inner">
          <button className="btn ghost" onClick={back}>
            <IconArrowLeft size={16} />
            {st.step === 0 ? t('common.cancel') : t('common.back')}
          </button>
          <span className="spacer" />
          {st.step === 1 && targets.length === 0 && <span className="faint small">{t('setup.targets.optional')}</span>}
          <button className="btn primary lg" disabled={!canNext} onClick={next} data-testid="setup-next">
            {st.step === 2 ? t('setup.start.go') : t('common.next')}
            <IconArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Schritt 1: Fotos

function StepSource() {
  const st = useStore((s) => s.setup)!;
  const c = st.count;
  return (
    <>
      <h1>{t('setup.source.title')}</h1>
      <p className="lead">{t('setup.source.sub')}</p>
      <div className="card">
        <div className="source-list">
          {st.sources.map((src, i) => (
            <div key={src} className="source-card" data-testid="source-row">
              <div className="s-icon">
                <IconFolder size={26} />
              </div>
              <div className="grow">
                <div className="s-name ellipsis">{basename(src)}</div>
                <div className="faint small ellipsis">{src}</div>
                {c?.perDir && st.sources.length > 1 && (
                  <div className="small muted" style={{ marginTop: 4 }}>
                    {t('setup.source.files', { n: fmtNum(c.perDir[i] ?? 0) })}
                  </div>
                )}
              </div>
              {st.sources.length > 1 ? (
                <button className="btn icon ghost sm" onClick={() => removeSetupSource(src)} {...tip(t('setup.source.remove'), t('tip.removeSource'))}>
                  <IconClose size={15} />
                </button>
              ) : (
                <button className="btn" onClick={pickSetupSource} {...tip(t('setup.source.other'), t('tip.otherSource'))}>
                  {t('setup.source.other')}
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="setting-row" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="lbl">
            <div className="t" data-testid="source-count">
              {st.counting || !c ? (
                <span className="row muted">
                  <Spinner small />
                  {t('setup.source.counting')}
                </span>
              ) : c.total === 0 ? (
                <span className="badge warn">{t('setup.source.none')}</span>
              ) : (
                <span className="badge accent">
                  <IconImage size={12} />
                  {countLabel(c.images, c.videos)}
                </span>
              )}
            </div>
          </div>
          <button className="btn" onClick={addSetupSource} data-testid="add-source" {...tip(t('setup.source.add'), t('tip.addSource'))}>
            <IconPlus size={15} />
            {t('setup.source.add')}
          </button>
        </div>
        {c && c.sample.length > 0 && (
          <div className="thumbs-row" style={{ padding: '0 18px 18px', marginTop: 0 }}>
            {c.sample.map((p) => (
              <div key={p} className="th">
                <img src={thumbUrl(p, 256)} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
              </div>
            ))}
          </div>
        )}
        <div className="setting-row" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="lbl">
            <div className="t">
              {t('setup.recursive')}
              <Help title={t('setup.recursive')} text={t('setup.recursive.help')} />
            </div>
          </div>
          <Switch on={st.recursive} onChange={(v) => updateSetup({ recursive: v })} label={t('setup.recursive')} />
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Schritt 2: Zielordner

function StepTargets() {
  const st = useStore((s) => s.setup)!;
  const settings = useStore((s) => s.settings);
  const expert = settings.prefs.mode === 'expert';
  const prof = activeProfile();
  const [creating, setCreating] = useState(prof.targets.length === 0);
  const [name, setName] = useState('');
  const [parent, setParent] = useState<string>('');
  const colorMenu = useMenu();
  const [colorFor, setColorFor] = useState<string | null>(null);

  useEffect(() => {
    window.api.parentDir(st.sources[0]).then(setParent);
  }, [st.sources]);

  const create = async () => {
    if (!name.trim() || !parent) return;
    const dir = await createTargetFolder(parent, name.trim());
    if (dir) {
      setName('');
      setCreating(false);
    }
  };

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <h1>{t('setup.targets.title')}</h1>
          <p className="lead">{t('setup.targets.sub')}</p>
        </div>
        {expert && (
          <div className="row" style={{ marginTop: 6 }}>
            <IconLayers size={16} className="faint" />
            <select className="select sm" value={prof.id} onChange={(e) => setActiveProfile(e.target.value)} title={t('setup.targets.set')}>
              {settings.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              className="btn sm"
              onClick={() => {
                const id = uid('p');
                updateSettings((s) => ({ ...s, profiles: [...s.profiles, { id, name: t('setup.targets.newSet'), targets: [], groups: [] }] }));
                setActiveProfile(id);
                setCreating(true);
              }}
            >
              {t('setup.targets.newSet')}
            </button>
            <Help topic="profile" />
          </div>
        )}
      </div>

      <div className="card" data-testid="target-list">
        {prof.targets.length === 0 && !creating ? (
          <div className="empty-state">
            <IllEmptyTargets />
            <div>{t('setup.targets.empty')}</div>
          </div>
        ) : (
          <div className="target-list">
            {prof.targets.map((tg) => (
              <div key={tg.id} className="target-row" data-testid="target-row">
                <button
                  className="tr-color"
                  style={{ background: tg.color }}
                  {...tip(t('targets.menu.color'), t('tip.color'))}
                  onClick={(e) => {
                    setColorFor(tg.id);
                    colorMenu.open(e, 'left', 200);
                  }}
                />
                <div className="grow">
                  <input
                    className="tr-name"
                    value={tg.name}
                    onChange={(e) => updateTarget(tg.id, { name: e.target.value })}
                    aria-label={t('common.rename')}
                  />
                  <div className="faint small ellipsis" title={tg.path}>
                    {tg.path}
                  </div>
                </div>
                <div className="col" style={{ alignItems: 'center', gap: 2 }}>
                  <KeyCap
                    k={tg.key}
                    size="lg"
                    onClick={() => openDialog({ type: 'keyCapture', targetId: tg.id })}
                    title={t('setup.targets.keyHint')}
                    tipText={t('tip.key')}
                  />
                  <span className="faint" style={{ fontSize: 10.5 }}>
                    {t('setup.targets.key')}
                  </span>
                </div>
                <button className="btn icon ghost sm" onClick={() => removeTarget(tg.id)} {...tip(t('setup.targets.removeTip'), t('tip.removeTarget'))}>
                  <IconClose size={15} />
                </button>
              </div>
            ))}
            {creating && (
              <div className="target-row" style={{ background: 'var(--surface-2)' }}>
                <span className="tr-color" style={{ background: COLORS[prof.targets.length % COLORS.length] }} />
                <div className="grow">
                  <input
                    className="input"
                    style={{ width: '100%' }}
                    autoFocus
                    placeholder={t('setup.targets.createPlaceholder')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') create();
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setCreating(false);
                      }
                    }}
                    data-testid="new-folder-name"
                  />
                  <div className="faint small row" style={{ marginTop: 6, gap: 6 }}>
                    <span className="ellipsis">
                      {t('setup.targets.createIn')} <span className="mono">{parent}</span>
                    </span>
                    <button
                      className="link small"
                      onClick={async () => {
                        const d = await window.api.pickFolder({ title: t('setup.targets.createIn'), defaultPath: parent });
                        if (d) setParent(d);
                      }}
                    >
                      {t('common.change')}
                    </button>
                  </div>
                </div>
                <button className="btn primary" disabled={!name.trim()} onClick={create} data-testid="new-folder-create">
                  {t('setup.targets.createBtn')}
                </button>
                {prof.targets.length > 0 && (
                  <button className="btn icon ghost sm" onClick={() => setCreating(false)} aria-label={t('common.cancel')}>
                    <IconClose size={15} />
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="add-row">
        {!creating && (
          <button className="btn" onClick={() => setCreating(true)} data-testid="create-folder" {...tip(t('setup.targets.create'), t('tip.createFolder'))}>
            <IconFolderPlus size={16} />
            {t('setup.targets.create')}
          </button>
        )}
        <button className="btn" onClick={pickAndAddTarget} data-testid="pick-folder" {...tip(t('setup.targets.existing'), t('tip.pickFolder'))}>
          <IconFolder size={16} />
          {t('setup.targets.existing')}
        </button>
        <span className="spacer" />
        <Help title={t('setup.targets.title')} text={t('targets.help')} />
      </div>

      <MenuPopup at={colorMenu.at} onClose={colorMenu.close}>
        <div className="colors">
          {COLORS.map((c) => (
            <button
              key={c}
              style={{ background: c }}
              aria-label={c}
              onClick={() => colorFor && updateTarget(colorFor, { color: c })}
            />
          ))}
        </div>
      </MenuPopup>
    </>
  );
}

// ------------------------------------------------------------------ Schritt 3: Start

function StepStart() {
  const st = useStore((s) => s.setup)!;
  const prefs = useStore((s) => s.settings.prefs);
  const expert = prefs.mode === 'expert';
  const prof = activeProfile();
  const [more, setMore] = useState(false);
  const c = st.count;
  return (
    <>
      <h1>{t('setup.start.title')}</h1>
      <p className="lead">{t('setup.start.sub')}</p>

      <div className="summary-line">
        <div className="card">
          <div className="ic">
            <IconImage size={20} />
          </div>
          <div className="grow">
            <div style={{ fontWeight: 650 }} className="ellipsis">
              {st.sources.map(basename).join(' + ')}
            </div>
            <div className="faint small">
              {c ? countLabel(c.images, c.videos) : '…'}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="ic">
            <IconFolder size={20} />
          </div>
          <div className="grow">
            <div style={{ fontWeight: 650 }}>{t('home.folders', { n: prof.targets.length })}</div>
            <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
              {prof.targets.slice(0, 8).map((tg) => (
                <KeyCap key={tg.id} k={tg.key} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="section-label">{t('setup.start.view')}</div>
      <div className="choice-grid cols-2">
        {(['single', 'grid'] as const).map((v) => (
          <button key={v} className={`choice view-choice ${st.startView === v ? 'on' : ''}`} onClick={() => updateSetup({ startView: v })}>
            <div className="vc-ill muted">{v === 'single' ? <IllSingle /> : <IllGrid />}</div>
            <span className="ch-title">{t(`setup.view.${v}`)}</span>
            <span className="ch-desc">{t(`setup.view.${v}.desc`)}</span>
            <span className="ch-check">
              <IconCheck size={13} strokeWidth={3} />
            </span>
          </button>
        ))}
      </div>

      {expert && (
      <button className="disclosure" onClick={() => setMore(!more)}>
        {more ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
        {t('setup.start.advanced')}
      </button>
      )}
      {expert && more && (
        <div className="card">
          <div className="setting-row">
            <div className="lbl">
              <div className="t">
                {t('setup.trash')} <Help topic="trash" />
              </div>
              <div className="d ellipsis">{st.trashDir || t('setup.trash.default')}</div>
            </div>
            {st.trashDir && (
              <button className="btn sm ghost" onClick={() => updateSetup({ trashDir: null })}>
                {t('common.default')}
              </button>
            )}
            <button
              className="btn sm"
              onClick={async () => {
                const d = await window.api.pickFolder({ title: t('setup.trash') });
                if (d) updateSetup({ trashDir: d });
              }}
            >
              {t('common.change')}
            </button>
          </div>
          <div className="setting-row">
            <div className="lbl">
              <div className="t">
                {t('setup.copy')} <Help topic="mode" />
              </div>
              <div className="d">{t('setup.copy.desc')}</div>
            </div>
            <Switch on={prefs.transferMode === 'copy'} onChange={(v) => updatePrefs({ transferMode: v ? 'copy' : 'move' })} />
          </div>
          <div className="setting-row">
            <div className="lbl">
              <div className="t">{t('setup.fullscreen')}</div>
              <div className="d">{t('setup.fullscreen.desc')}</div>
            </div>
            <Switch on={st.fullscreen} onChange={(v) => updateSetup({ fullscreen: v })} />
          </div>
        </div>
      )}
    </>
  );
}

