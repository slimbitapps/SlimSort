import { useEffect, useState, type ReactNode } from 'react';
import { t, LANGS, getLocale, type TKey } from '../i18n';
import {
  useStore, closeDialog, updatePrefs, activeProfile, updateSettings, setActiveProfile, openDialog, restartTutorial,
  toast, previewSeriesCount, newName, updateProfile, checkForUpdate,
} from '../store';
import { tip } from './Tooltip';
import slimbitMark from '../assets/slimbit-mark.png';
import type { AppInfo, Prefs, Profile } from '../types';
import { Help, KeyCap, Logo, Switch, MenuPopup, useMenu } from './ui';
import {
  IconGlobe, IconSliders, IconTrash, IconImage, IconLayers, IconSettings, IconHelp, IconInfo, IconClose, IconCheck,
  IconLock, IconRefresh, IconPlus, IconMore, IconLayers as IconStack, IconSparkle,
  IconDownload, IconUpload,
} from '../icons';
import { useAi, applyAiPrefs, startDownload, currentTier, refreshRules } from '../ai';
import { exportKnowledge, importKnowledge } from '../knowledge';
import { useChats, deleteAllChats } from '../chats';
import { grant, PERMISSION_TEXT, describeMemory, removeMemory, clearMemories, type Permission } from '../aimemory';
import type { AiTier } from '../types';
import { actionKeyOf, keyLabel, modKey, uid } from '../util';
import type { ActionKeys, DateFolders, Item } from '../types';

const ACCENTS: [Prefs['accent'], string][] = [
  ['blue', '#5b7cfa'],
  ['violet', '#8b5cf6'],
  ['pink', '#e8559a'],
  ['orange', '#f07a2a'],
  ['green', '#22a861'],
  ['teal', '#0ea5b7'],
];

/** Beispiel für den neuen Dateinamen */
function renameExample(mode: Prefs['renameMode']) {
  const demo = { name: 'IMG_4821.JPG', t: new Date(2025, 7, 3, 14, 22, 5).getTime(), mtime: 0 } as Item;
  return (mode === 'keep' ? 'IMG_4821' : newName(demo, mode)) + '.JPG';
}

/** Unterordner nach Datum für alle Zielordner des aktiven Sets */
function DateFoldersRow() {
  useStore((s) => s.settings.profiles);
  const prof = activeProfile();
  const modes = new Set(prof.targets.map((x) => x.subfolders || 'none'));
  const value = modes.size === 1 ? [...modes][0] : 'mixed';
  return (
    <Row label={t('settings.dateFolders')} desc={t('settings.dateFolders.desc')}>
      <select
        className="select"
        value={value}
        disabled={!prof.targets.length}
        onChange={(e) => {
          const v = e.target.value as DateFolders;
          updateProfile(prof.id, (p) => ({ ...p, targets: p.targets.map((x) => ({ ...x, subfolders: v })) }));
        }}
        data-testid="datefolders-select"
      >
        {value === 'mixed' && <option value="mixed">{t('settings.dateFolders.mixed')}</option>}
        <option value="none">{t('targets.sub.none')}</option>
        <option value="year">{t('targets.sub.year')}</option>
        <option value="month">{t('targets.sub.month')}</option>
        <option value="day">{t('targets.sub.day')}</option>
      </select>
    </Row>
  );
}

/** Taste für eine Grundaktion neu belegen */
function KeyRow({ label, k }: { label: string; k: keyof ActionKeys }) {
  const keys = useStore((s) => s.settings.prefs.keys);
  const [listen, setListen] = useState(false);
  useEffect(() => {
    if (!listen) return;
    const on = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setListen(false);
      const key = actionKeyOf(e);
      if (!key) return;
      setListen(false);
      const other = (Object.keys(keys) as (keyof ActionKeys)[]).find((x) => x !== k && keys[x] === key);
      // Taste schon vergeben? Dann tauschen.
      updatePrefs({ keys: { ...keys, [k]: key, ...(other ? { [other]: keys[k] } : {}) } });
      if (activeProfile().targets.some((tg) => tg.key === key)) toast('info', t('settings.keys.targetClash', { key: keyLabel(key) }), { timeout: 5000 });
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [listen, keys, k]);
  return (
    <Row label={label}>
      <button className={`btn ${listen ? 'primary' : ''}`} onClick={() => setListen(!listen)} data-testid={`key-${k}`}>
        {listen ? t('settings.keys.press') : <KeyCap k={keyLabel(keys[k])} />}
      </button>
    </Row>
  );
}

type Tab = 'general' | 'ai' | 'series' | 'sorting' | 'trash' | 'display' | 'sets' | 'advanced' | 'help' | 'about';

function Row({ label, desc, help, children }: { label: string; desc?: ReactNode; help?: string; children?: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="lbl">
        <div className="t">
          {label}
          {help && <Help title={label} text={help} />}
        </div>
        {desc && <div className="d">{desc}</div>}
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

function Group({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="settings-group">
      {label && <div className="section-label">{label}</div>}
      <div className="card">{children}</div>
    </div>
  );
}

export function SettingsDialog({ tab: initial }: { tab?: string }) {
  const p = useStore((s) => s.settings.prefs);
  const expert = p.mode === 'expert';
  const [tab, setTab] = useState<Tab>((initial as Tab) || 'general');
  const all: [Tab, string, ReactNode, boolean][] = [
    ['general', t('settings.general'), <IconGlobe size={17} key="g" />, true],
    ['series', t('settings.series'), <IconStack size={17} key="r" />, true],
    ['sorting', t('settings.sorting'), <IconSliders size={17} key="s" />, true],
    ['trash', t('settings.trash'), <IconTrash size={17} key="t" />, expert],
    ['display', t('settings.display'), <IconImage size={17} key="d" />, true],
    ['ai', t('ai.tab'), <IconSparkle size={17} key="k" />, true],
    ['sets', t('settings.sets'), <IconLayers size={17} key="p" />, expert],
    ['advanced', t('settings.advanced'), <IconSettings size={17} key="a" />, expert],
    ['help', t('settings.help'), <IconHelp size={17} key="h" />, true],
    ['about', t('settings.about'), <IconInfo size={17} key="i" />, true],
  ];
  const nav = all.filter((x) => x[3]);
  // Im Einfach-Modus ausgeblendeten Bereich nicht offen lassen
  if (!nav.some((x) => x[0] === tab)) setTimeout(() => setTab('general'), 0);
  const set = (x: Partial<Prefs>) => updatePrefs(x);

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}>
      <div className="dialog xwide" role="dialog" aria-label={t('menu.settings')} data-testid="settings">
        <div className="settings">
          <nav className="settings-nav">
            <h2>{t('menu.settings')}</h2>
            {nav.map(([id, label, icon]) => (
              <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)} data-testid={`settings-${id}`}>
                {icon}
                {label}
              </button>
            ))}
          </nav>
          <div className="settings-main">
            <button className="btn icon ghost sm close-x" onClick={closeDialog} aria-label={t('common.close')}>
              <IconClose size={16} />
            </button>

            {tab === 'general' && (
              <>
                <h3>{t('settings.general')}</h3>
                <p className="sub">{t('settings.general.sub')}</p>
                <Group>
                  <Row label={t('settings.lang')}>
                    <select className="select" value={p.lang} onChange={(e) => set({ lang: e.target.value as Prefs['lang'] })} data-testid="lang-select">
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
                        ['light', t('theme.light')],
                        ['dark', t('theme.dark')],
                        ['system', t('theme.system')],
                      ]}
                    />
                  </Row>
                  <Row label={t('settings.mode')} desc={t(p.mode === 'simple' ? 'mode.simple.desc' : 'mode.expert.desc')}>
                    <Seg
                      value={p.mode}
                      onChange={(v) => set({ mode: v })}
                      options={[
                        ['simple', t('mode.simple')],
                        ['expert', t('mode.expert')],
                      ]}
                    />
                  </Row>
                </Group>
              </>
            )}

            {tab === 'sorting' && (
              <>
                <h3>{t('settings.sorting')}</h3>
                <p className="sub">{t('settings.sorting.sub')}</p>
                <Group>
                  {expert && (
                  <Row label={t('settings.transferMode')} help={t('help.mode.body')}>
                    <Seg
                      value={p.transferMode}
                      onChange={(v) => set({ transferMode: v })}
                      options={[
                        ['move', t('ses.mode.move')],
                        ['copy', t('ses.mode.copy')],
                      ]}
                    />
                  </Row>
                  )}
                  <Row label={t('settings.recursive')} desc={t('setup.recursive.help')}>
                    <Switch on={p.recursive} onChange={(v) => set({ recursive: v })} />
                  </Row>
                  <Row label={t('settings.resume')} desc={t('settings.resume.desc')}>
                    <Switch on={p.resume} onChange={(v) => set({ resume: v })} />
                  </Row>
                </Group>
                <Group label={t('settings.files')}>
                  <Row label={t('settings.rename')} desc={t('settings.rename.desc', { ex: renameExample(p.renameMode) })}>
                    <select className="select" value={p.renameMode} onChange={(e) => set({ renameMode: e.target.value as Prefs['renameMode'] })} data-testid="rename-select">
                      <option value="keep">{t('settings.rename.keep')}</option>
                      <option value="date">{t('settings.rename.date')}</option>
                      <option value="dateName">{t('settings.rename.dateName')}</option>
                    </select>
                  </Row>
                  <DateFoldersRow />
                </Group>
                <Group label={t('settings.keys')}>
                  <KeyRow label={t('ses.skip')} k="skip" />
                  <KeyRow label={t('ses.delete')} k="trash" />
                  <KeyRow label={t('ses.otherShort')} k="other" />
                </Group>
                <Group label={t('settings.live')}>
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
                </Group>
                {expert && (
                <Group label={t('settings.suggest')}>
                  <Row label={t('settings.suggest.on')} desc={t('settings.suggest.help')}>
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
                </Group>
                )}
              </>
            )}

            {tab === 'series' && <SeriesTab />}

            {tab === 'trash' && (
              <>
                <h3>{t('settings.trash')}</h3>
                <p className="sub">{t('help.trash.body')}</p>
                <Group>
                  <Row label={t('settings.systemTrash')} desc={t('settings.systemTrash.desc')}>
                    <Switch on={p.emptyToSystemTrash} onChange={(v) => set({ emptyToSystemTrash: v })} />
                  </Row>
                  <Row label={t('settings.trashMode')}>
                    <Seg
                      value={p.trashMode}
                      onChange={(v) => set({ trashMode: v })}
                      options={[
                        ['source', t('settings.trash.inSource')],
                        ['custom', t('settings.trash.custom')],
                      ]}
                    />
                  </Row>
                  {p.trashMode === 'custom' && (
                    <Row label={t('settings.trash.folder')} desc={<span className="mono">{p.customTrash || '—'}</span>}>
                      <button
                        className="btn"
                        onClick={async () => {
                          const d = await window.api.pickFolder({ title: t('settings.trash.folder') });
                          if (d) set({ customTrash: d });
                        }}
                      >
                        {t('common.choose')}
                      </button>
                    </Row>
                  )}
                </Group>
              </>
            )}

            {tab === 'display' && (
              <>
                <h3>{t('settings.display')}</h3>
                <p className="sub">{t('settings.display.sub')}</p>
                <Group label={t('settings.look')}>
                  <Row label={t('settings.accent')}>
                    <div className="colors" style={{ padding: 0 }} data-testid="accent">
                      {ACCENTS.map(([id, c]) => (
                        <button key={id} className={p.accent === id ? 'on' : ''} style={{ background: c, width: 24, height: 24 }} aria-label={id} onClick={() => set({ accent: id })} />
                      ))}
                    </div>
                  </Row>
                  <Row label={t('settings.viewerBg')} desc={t('settings.viewerBg.desc')}>
                    <Seg
                      value={p.viewerBg}
                      onChange={(v) => set({ viewerBg: v })}
                      options={[
                        ['theme', t('settings.viewerBg.theme')],
                        ['black', t('settings.viewerBg.black')],
                        ['dark', t('settings.viewerBg.dark')],
                        ['gray', t('settings.viewerBg.gray')],
                      ]}
                    />
                  </Row>
                  <Row label={t('settings.uiScale')}>
                    <Seg
                      value={String(p.uiScale || 1)}
                      onChange={(v) => set({ uiScale: Number(v) })}
                      options={[
                        ['0.9', '90 %'],
                        ['1', '100 %'],
                        ['1.1', '110 %'],
                        ['1.25', '125 %'],
                      ]}
                    />
                  </Row>
                </Group>
                <Group>
                  <Row label={t('settings.filmstrip')} desc={t('settings.filmstrip.desc')}>
                    <Switch on={p.showFilmstrip} onChange={(v) => set({ showFilmstrip: v })} />
                  </Row>
                  <Row label={t('settings.showEta')}>
                    <Switch on={p.showEta} onChange={(v) => set({ showEta: v })} />
                  </Row>
                  <Row label={t('settings.zenFlash')} desc={t('help.zen.body')}>
                    <Switch on={p.zenFlash} onChange={(v) => set({ zenFlash: v })} />
                  </Row>
                  <Row label={t('settings.thumbSize')}>
                    <input type="range" min={110} max={320} step={10} value={p.thumbSize} onChange={(e) => set({ thumbSize: Number(e.target.value) })} />
                  </Row>
                </Group>
              </>
            )}

            {tab === 'ai' && <AiTab />}
            {tab === 'sets' && <SetsTab />}
            {tab === 'advanced' && <AdvancedTab />}
            {tab === 'help' && <HelpTab />}
            {tab === 'about' && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

function SetsTab() {
  const settings = useStore((s) => s.settings);
  const active = activeProfile();
  const menu = useMenu();
  const [menuFor, setMenuFor] = useState<Profile | null>(null);
  const add = (p: Profile) => {
    updateSettings((s) => ({ ...s, profiles: [...s.profiles, p] }));
    setActiveProfile(p.id);
  };
  const rename = (p: Profile) =>
    openDialog({
      type: 'prompt',
      title: t('common.rename'),
      value: p.name,
      onOk: (v) => {
        updateSettings((s) => ({ ...s, profiles: s.profiles.map((x) => (x.id === p.id ? { ...x, name: v } : x)) }));
        openDialog({ type: 'settings', tab: 'sets' });
      },
    });
  const remove = async (p: Profile) => {
    const r = await window.api.confirm({
      message: t('sets.confirmDelete', { name: p.name }),
      buttons: [t('common.delete'), t('common.cancel')],
      type: 'warning',
    });
    if (r !== 0) return;
    const rest = settings.profiles.filter((x) => x.id !== p.id);
    updateSettings((s) => ({ ...s, profiles: rest }));
    if (p.id === active.id) setActiveProfile(rest[0].id);
  };
  return (
    <>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <h3>{t('settings.sets')}</h3>
          <p className="sub">{t('help.profile.body')}</p>
        </div>
        <button className="btn primary" onClick={() => add({ id: uid('p'), name: t('setup.targets.newSet'), targets: [], groups: [] })} {...tip(t('setup.targets.newSet'), t('tip.newSet'))}>
          <IconPlus size={15} />
          {t('setup.targets.newSet')}
        </button>
      </div>
      <div className="card">
        {settings.profiles.map((p) => {
          const on = p.id === active.id;
          return (
            <div key={p.id} className="sets-row">
              <div className="grow">
                <div className="row" style={{ gap: 8 }}>
                  <span style={{ fontWeight: 650 }} className="ellipsis">
                    {p.name}
                  </span>
                  {on && <span className="badge accent">{t('sets.active')}</span>}
                </div>
                <div className="row small faint" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {p.targets.length === 0 && t('sets.empty')}
                  {p.targets.slice(0, 10).map((tg) => (
                    <span key={tg.id} className="row" style={{ gap: 4 }}>
                      <span className="dot" style={{ background: tg.color, width: 8, height: 8 }} />
                      {tg.name}
                    </span>
                  ))}
                </div>
              </div>
              {!on && (
                <button className="btn sm" onClick={() => setActiveProfile(p.id)} {...tip(t('sets.use'), t('tip.useSet'))}>
                  {t('sets.use')}
                </button>
              )}
              <button
                className="btn icon ghost sm"
                onClick={(e) => {
                  setMenuFor(p);
                  menu.open(e, 'right', 200);
                }}
                {...tip(t('common.more'), t('tip.setMenu'))}
              >
                <IconMore size={16} />
              </button>
            </div>
          );
        })}
      </div>
      <MenuPopup at={menu.at} onClose={menu.close}>
        {menuFor && (
          <>
            <button className="mi" onClick={() => rename(menuFor)}>
              {t('common.rename')}
            </button>
            <button
              className="mi"
              onClick={() =>
                add({
                  ...structuredClone(menuFor),
                  id: uid('p'),
                  name: t('sets.copyOf', { name: menuFor.name }),
                  targets: menuFor.targets.map((x) => ({ ...x, id: uid('tg') })),
                })
              }
            >
              {t('sets.duplicate')}
            </button>
            {settings.profiles.length > 1 && (
              <>
                <div className="sep" />
                <button className="mi danger" onClick={() => remove(menuFor)}>
                  {t('common.delete')}
                </button>
              </>
            )}
          </>
        )}
      </MenuPopup>
    </>
  );
}

function SeriesTab() {
  const p = useStore((s) => s.settings.prefs);
  useStore((s) => s.session?.rev);
  const [gapText, setGapText] = useState(String(p.seriesGapSec).replace('.', ','));
  const gap = Number(gapText.replace(',', '.'));
  const valid = isFinite(gap) && gap > 0 && gap <= 3600;
  const preview = valid ? previewSeriesCount(gap) : null;
  const set = (x: Partial<Prefs>) => updatePrefs(x);
  const commitGap = (v: string) => {
    setGapText(v);
    const n = Number(v.replace(',', '.'));
    if (isFinite(n) && n > 0 && n <= 3600) set({ seriesGapSec: n });
  };
  return (
    <>
      <h3>{t('settings.series')}</h3>
      <p className="sub">{t('settings.series.sub')}</p>
      <Group>
        <Row label={t('settings.series.on')} desc={t('settings.series.onDesc')}>
          <Switch on={p.seriesEnabled} onChange={(v) => set({ seriesEnabled: v })} />
        </Row>
      </Group>
      {p.seriesEnabled && (
        <>
          <Group label={t('settings.series.when')}>
            <Row label={t('settings.series.gap')} desc={t('settings.series.gapDesc')}>
              <div className="row">
                <input
                  className="input"
                  style={{ width: 80, textAlign: 'right' }}
                  value={gapText}
                  onChange={(e) => commitGap(e.target.value)}
                  inputMode="decimal"
                  data-testid="series-gap"
                />
                <span className="muted">{t('common.seconds')}</span>
              </div>
            </Row>
            <div className="setting-row" style={{ paddingTop: 0 }}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {[0.5, 1, 3, 5, 10, 30].map((v) => (
                  <button key={v} className={`btn sm ${p.seriesGapSec === v ? 'on' : ''}`} onClick={() => commitGap(String(v).replace('.', ','))}>
                    {String(v).replace('.', ',')} s
                  </button>
                ))}
              </div>
              <span className="spacer" />
              <span className="small muted" data-testid="series-preview">
                {!valid ? t('settings.series.invalid') : preview === null ? t('settings.series.previewLater') : t('settings.series.preview', { n: preview })}
              </span>
            </div>
            <Row label={t('settings.series.strict')} desc={t('settings.series.strictDesc')}>
              <Seg
                value={p.seriesStrict}
                onChange={(v) => set({ seriesStrict: v })}
                options={[
                  ['loose', t('settings.series.loose')],
                  ['normal', t('settings.series.normal')],
                  ['strict', t('settings.series.strictOpt')],
                ]}
              />
            </Row>
          </Group>
          <Group label={t('settings.series.compare')}>
            <Row label={t('settings.series.auto')} desc={t('settings.series.autoDesc')}>
              <Switch on={p.autoCompare} onChange={(v) => set({ autoCompare: v })} />
            </Row>
            <Row label={t('settings.series.best')} desc={t('settings.series.bestDesc')}>
              <Switch on={p.preselectBest} onChange={(v) => set({ preselectBest: v })} />
            </Row>
          </Group>
          <Group label={t('settings.series.howto')}>
            <div className="setting-row" style={{ display: 'block' }}>
              <div className="muted" style={{ whiteSpace: 'pre-line', lineHeight: 1.7 }}>
                {t('settings.series.howtoText')}
              </div>
            </div>
          </Group>
        </>
      )}
    </>
  );
}

/** Download-Größe je Stufe (MB) */
const TIER_MB: Record<AiTier, number> = { eco: 187, balanced: 1460, max: 3340 };
const fmtSize = (mb: number) => (mb >= 1000 ? `${(mb / 1000).toLocaleString(getLocale(), { maximumFractionDigits: 1 })} GB` : `${mb} MB`);

function TierPicker({ busy, onPick }: { busy: boolean; onPick: (t: AiTier) => void }) {
  const st = useAi((a) => a.status);
  const cur = currentTier();
  const hw = st?.hw;
  const tiers: [AiTier, TKey, TKey][] = [
    ['eco', 'ai.tierEco', 'ai.tierEcoDesc'],
    ['balanced', 'ai.tierBalanced', 'ai.tierBalancedDesc'],
    ['max', 'ai.tierMax', 'ai.tierMaxDesc'],
  ];
  return (
    <div className="ai-tiers" data-testid="ai-tiers">
      {tiers.map(([id, name, desc]) => {
        const noChat = id !== 'eco' && hw && !hw.chatOk;
        return (
          <button
            key={id}
            className={`ai-tier ${cur === id ? 'on' : ''}`}
            disabled={busy || !!noChat}
            onClick={() => onPick(id)}
            data-testid={`ai-tier-${id}`}
          >
            <span className="ai-tier-head">
              <b>{t(name)}</b>
              {hw?.recommended === id && <span className="ai-rec">{t('ai.recommended')}</span>}
            </span>
            <span className="ai-tier-desc">{noChat ? t('ai.tierNoCpu') : t(desc)}</span>
            <span className="ai-tier-size">{fmtSize(TIER_MB[id])}</span>
          </button>
        );
      })}
    </div>
  );
}

function AiTab() {
  const p = useStore((s) => s.settings.prefs);
  const st = useAi((a) => a.status);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    window.api.ai.status().then((s) => useAi.setState({ status: s }));
  }, []);
  const set = async (x: Partial<Prefs>) => {
    // beim ersten Einschalten die empfohlene Stufe merken
    if (x.aiEnabled && !p.aiTier && st?.hw) x = { ...x, aiTier: st.hw.recommended };
    updatePrefs(x);
    if ('aiEnabled' in x || 'aiPerf' in x || 'aiTier' in x || 'aiFaces' in x) {
      setBusy(true);
      await applyAiPrefs().finally(() => setBusy(false));
    }
  };
  const pct = st && st.size ? Math.round((100 * st.received) / st.size) : 0;
  return (
    <>
      <h3>{t('ai.tab')}</h3>
      <p className="sub">{t('ai.sub')}</p>
      <Group>
        <Row label={t('ai.enable')} desc={t('ai.enableDesc')}>
          <span data-testid="ai-enable">
            <Switch on={p.aiEnabled} onChange={(v) => set({ aiEnabled: v })} />
          </span>
        </Row>
        {p.aiEnabled && (
          <div className="ai-tier-wrap">
            <div className="lbl">
              <div className="t">{t('ai.tier')}</div>
              {st?.hw && <div className="d">{t('ai.hw', { ram: Math.round(st.hw.ramGb), cores: st.hw.cores })}</div>}
            </div>
            <TierPicker busy={busy || !!st?.downloading} onPick={(id) => set({ aiTier: id })} />
          </div>
        )}
        {p.aiEnabled && st && !st.installed && (
          <Row label={t('ai.model')} desc={st.downloading ? t('ai.downloading', { pct }) : st.error ? t('ai.downloadFailed', { error: st.error }) : t('ai.modelDesc', { mb: fmtSize(TIER_MB[currentTier()]) })}>
            {st.downloading ? (
              <div className="row" style={{ gap: 8, minWidth: 220 }}>
                <div className="ai-bar" data-testid="ai-download-bar">
                  <i style={{ width: `${pct}%` }} />
                </div>
                <button className="btn sm" onClick={() => window.api.ai.cancelDownload()}>
                  {t('common.cancel')}
                </button>
              </div>
            ) : (
              <button className="btn primary" onClick={startDownload} data-testid="ai-download">
                {t('ai.download', { mb: fmtSize(TIER_MB[currentTier()]) })}
              </button>
            )}
          </Row>
        )}
        {p.aiEnabled && st?.installed && (
          <Row
            label={t('ai.state')}
            desc={
              st.total
                ? t('ai.stateDesc', { done: st.indexed, total: st.total, learned: st.examples })
                : t('ai.stateDescIdle', { learned: st.examples })
            }
          >
            <span className={`ai-pill ${busy ? '' : 'on'}`} data-testid="ai-state">
              {busy ? '…' : st.total && st.indexed < st.total ? t('ai.working') : t('ai.ready')}
            </span>
          </Row>
        )}
      </Group>
      {p.aiEnabled && (
        <>
          <Group label={t('ai.groupUse')}>
            <Row label={t('ai.suggest')} desc={t('ai.suggestDesc')}>
              <Switch on={p.aiSuggest} onChange={(v) => set({ aiSuggest: v })} />
            </Row>
            <Row label={t('ai.learnFolders')} desc={t('ai.learnFoldersDesc')}>
              <Switch on={p.aiLearnFolders} onChange={(v) => set({ aiLearnFolders: v })} />
            </Row>
            <Row label={t('ai.autopilot')} desc={t('ai.autopilotDesc', { pct: Math.round(p.aiAutoConf * 100) })}>
              <Switch on={p.aiAutopilot} onChange={(v) => set({ aiAutopilot: v })} />
            </Row>
            <Row label={t('ai.autoConf')} desc={t('ai.autoConfDesc')}>
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="range"
                  min={70}
                  max={99}
                  value={Math.round(p.aiAutoConf * 100)}
                  onChange={(e) => set({ aiAutoConf: Number(e.target.value) / 100 })}
                />
                <b style={{ width: 40, textAlign: 'right' }}>{Math.round(p.aiAutoConf * 100)} %</b>
              </div>
            </Row>
          </Group>
          <PermGroup />
          <FacesGroup set={set} />
          <MemoryGroup />
          <KnowledgeGroup />
          <Group label={t('ai.groupPerf')}>
            <Row label={t('ai.perf')} desc={t('ai.perfDesc')}>
              <Seg
                value={p.aiPerf}
                options={[
                  ['low', t('ai.perfLow')],
                  ['normal', t('ai.perfNormal')],
                  ['high', t('ai.perfHigh')],
                ]}
                onChange={(v) => set({ aiPerf: v })}
              />
            </Row>
            <Row label={t('ai.forget')} desc={t('ai.forgetDesc')}>
              <button
                className="btn"
                onClick={async () => {
                  await window.api.ai.forget();
                  toast('success', t('ai.forgotten'));
                }}
              >
                {t('ai.forgetBtn')}
              </button>
            </Row>
            <Row label={t('ai.remove')} desc={t('ai.removeDesc')}>
              <button
                className="btn danger"
                onClick={async () => {
                  const r = await window.api.confirm({ message: t('ai.removeAsk'), detail: t('ai.removeDetail'), buttons: [t('ai.removeBtn'), t('common.cancel')], type: 'warning' });
                  if (r !== 0) return;
                  await window.api.ai.remove();
                  updatePrefs({ aiEnabled: false });
                  await applyAiPrefs();
                  toast('success', t('ai.removed'));
                }}
              >
                {t('ai.removeBtn')}
              </button>
            </Row>
          </Group>
        </>
      )}
      <p className="muted small" style={{ lineHeight: 1.5 }}>
        <IconLock size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
        {t('ai.privacy')}
      </p>
    </>
  );
}

/** Was die KI selbst tun darf – riskante Rechte nur nach Hinweis */
function PermGroup() {
  const p = useStore((s) => s.settings.prefs);
  const perms: Permission[] = ['aiAllowMove', 'aiAllowDelete', 'aiAllowFolders', 'aiAllowSettings'];
  const all = perms.every((x) => p[x]) && p.aiNoConfirm;
  return (
    <Group label={t('perm.title')}>
      <Row label={t('perm.allLabel')} desc={t('perm.hint')}>
        <button className={`btn ${all ? '' : 'danger'}`} data-testid="perm-all" onClick={() => grant('all', !all)}>
          {all ? t('perm.revokeAll') : t('perm.allowAll')}
        </button>
      </Row>
      {perms.map((x) => (
        <Row key={x} label={t(PERMISSION_TEXT[x])}>
          <span data-testid={`perm-${x}`}>
            <Switch on={!!p[x]} onChange={(v) => grant(x, v)} />
          </span>
        </Row>
      ))}
      <Row label={t('perm.noConfirm')} desc={t('perm.noConfirmDesc')}>
        <span data-testid="perm-aiNoConfirm">
          <Switch on={!!p.aiNoConfirm} onChange={(v) => grant('aiNoConfirm', v)} />
        </span>
      </Row>
    </Group>
  );
}

/** Gesichtserkennung (mit Datenschutz-Hinweis beim Einschalten) */
function FacesGroup({ set }: { set: (x: Partial<Prefs>) => Promise<void> }) {
  const p = useStore((s) => s.settings.prefs);
  const st = useAi((a) => a.status);
  const toggle = async (v: boolean) => {
    if (v) {
      const r = await window.api.confirm({ message: t('faces.ask'), detail: t('faces.privacy'), buttons: [t('faces.yes'), t('common.cancel')], type: 'warning' });
      if (r !== 0) return;
    }
    await set({ aiFaces: v });
    if (v) {
      const s = await window.api.ai.status();
      if (!s.installed && !s.downloading) startDownload();
    }
  };
  const desc = !p.aiFaces
    ? t('faces.desc')
    : st?.helperOld || (st?.downloading && !st?.facesReady)
      ? t('faces.updating')
      : st?.faceError
        ? t('faces.error', { error: st.faceError })
        : st?.facesReady
          ? `${t('faces.desc')} ${t('faces.status', { n: st.faceTotal ?? 0 })}${st.facesPending ? ` · ${t('faces.pending', { n: st.facesPending })}` : ''}.`
          : t('faces.desc');
  const n = useStore((s) => (s.settings.people || []).length);
  return (
    <Group>
      <Row label={t('faces.title')} desc={desc}>
        <span data-testid="ai-faces">
          <Switch on={p.aiFaces} onChange={toggle} />
        </span>
      </Row>
      {p.aiFaces && (
        <>
          <Row label={t('faces.show')} desc={t('faces.showDesc')}>
            <Switch on={p.showFaces} onChange={(v) => updatePrefs({ showFaces: v })} />
          </Row>
          <Row label={t('people.title')} desc={t('people.count', { n })}>
            <button className="btn" onClick={() => openDialog({ type: 'people' })} data-testid="people-open">
              {t('people.manage')}
            </button>
          </Row>
        </>
      )}
    </Group>
  );
}

/** Was sich die KI gemerkt hat – einzeln oder alles vergessen */
function MemoryGroup() {
  const list = useStore((s) => s.settings.aiMemory) || [];
  return (
    <Group label={t('mem.title')}>
      {list.map((m) => (
        <Row key={m.id} label={m.kind === 'note' ? t('mem.note', { text: m.text }) : describeMemory(m)} desc={m.kind === 'note' ? undefined : m.text}>
          <button className="btn sm" data-testid="mem-remove" onClick={() => (removeMemory(m.id), refreshRules())}>
            {t('mem.remove')}
          </button>
        </Row>
      ))}
      <Row label={list.length ? t('mem.count', { n: list.length }) : t('mem.none')} desc={t('mem.hint')}>
        {list.length > 0 && (
          <button
            className="btn danger"
            onClick={async () => {
              const r = await window.api.confirm({ message: t('mem.forgetAllAsk', { n: list.length }), buttons: [t('mem.forgetAllYes'), t('common.cancel')], type: 'warning' });
              if (r !== 0) return;
              clearMemories();
              refreshRules();
            }}
          >
            {t('mem.clearAll')}
          </button>
        )}
      </Row>
    </Group>
  );
}

/** KI-Wissen sichern / auf einen neuen Computer mitnehmen, Chats */
function KnowledgeGroup() {
  const chats = useChats((c) => c.list.length);
  return (
    <Group label={t('know.title')}>
      <Row label={t('know.export')} desc={t('know.exportDesc')}>
        <button className="btn" onClick={exportKnowledge} data-testid="know-export">
          <IconDownload size={15} />
          {t('know.exportBtn')}
        </button>
      </Row>
      <Row label={t('know.import')} desc={t('know.importDesc')}>
        <button className="btn" onClick={importKnowledge} data-testid="know-import">
          <IconUpload size={15} />
          {t('know.importBtn')}
        </button>
      </Row>
      <Row label={t('chat.saved')} desc={t('chat.savedDesc', { n: chats })}>
        <button
          className="btn"
          disabled={!chats}
          onClick={async () => {
            const r = await window.api.confirm({ message: t('chat.deleteAllAsk', { n: chats }), buttons: [t('chat.deleteAll'), t('common.cancel')], type: 'warning' });
            if (r === 0) deleteAllChats();
          }}
        >
          {t('chat.deleteAll')}
        </button>
      </Row>
    </Group>
  );
}

function AdvancedTab() {
  const updateOn = useStore((s) => s.settings.prefs.updateCheck);
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    window.api.appInfo().then(setInfo);
  }, []);
  return (
    <>
      <h3>{t('settings.advanced')}</h3>
      <p className="sub">{t('settings.advanced.sub')}</p>
      <Group>
        <Row label={t('settings.updates')} desc={t('settings.updates.desc')}>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" onClick={() => checkForUpdate(true)}>
              {t('settings.updates.now')}
            </button>
            <Switch on={updateOn} onChange={(v) => updatePrefs({ updateCheck: v })} />
          </div>
        </Row>
        <Row label={t('settings.journal')} desc={t('settings.journal.help')}>
          <button className="btn" disabled={!info} onClick={() => info && window.api.openPath(info.journal)}>
            {t('common.open')}
          </button>
        </Row>
        <Row label={t('settings.dataFolder')} desc={<span className="mono">{info?.userData}</span>}>
          <button className="btn" disabled={!info} onClick={() => info && window.api.openPath(info.userData)}>
            {t('common.open')}
          </button>
        </Row>
        <Row label={t('settings.cache')} desc={t('settings.cache.desc')}>
          <button
            className="btn"
            onClick={async () => {
              await window.api.clearCache();
              toast('success', t('settings.cacheDone'));
            }}
          >
            {t('settings.cache.btn')}
          </button>
        </Row>
      </Group>
    </>
  );
}

function HelpTab() {
  useStore((s) => s.settings.profiles);
  const mod = modKey();
  const mac = window.api.platform === 'darwin';
  const prof = activeProfile();
  const keys: [TKey, string[]][] = [
    ['keys.sortKey', ['1', '2', 'A', '…']],
    ['keys.skip', [t('key.space')]],
    ['keys.delete', mac ? ['⌫'] : [t('key.del')]],
    ['keys.undo', [mod, 'Z']],
    ['keys.nav', ['←', '→']],
    ['keys.toggleView', ['Tab']],
    ['keys.other', ['Enter']],
    ['keys.series', ['⇧', '1', '…']],
    ['keys.cmpKeep', ['⇧', '1', '…', '6']],
    ['keys.cmpDone', ['Enter']],
    ['keys.fullscreen', ['F11']],
    ['keys.zen', ['F10']],
    ['keys.esc', ['Esc']],
    ['keys.selectAll', [mod, 'A']],
    ['keys.zoom', ['+', '−', `${mod} 0`]],
    ['keys.firstLast', [t('key.home'), t('key.end')]],
    ['keys.help', ['F1']],
  ];
  return (
    <>
      <h3>{t('settings.help')}</h3>
      <p className="sub">{t('settings.help.sub')}</p>
      <Group>
        <Row label={t('help.tutorial')} desc={t('help.tutorial.desc')}>
          <button className="btn" onClick={restartTutorial} data-testid="restart-tutorial">
            <IconRefresh size={15} />
            {t('help.tutorial.btn')}
          </button>
        </Row>
      </Group>

      <div className="section-label">{t('keys.title')}</div>
      <div className="keys-table" style={{ marginBottom: 20 }}>
        {keys.map(([label, ks]) => (
          <div key={label} className="kr">
            <span>{t(label)}</span>
            <span className="ks">
              {ks.map((k, i) => (
                <KeyCap key={i} k={k} />
              ))}
            </span>
          </div>
        ))}
      </div>

      {prof.targets.length > 0 && (
        <>
          <div className="section-label">{t('keys.targets')}</div>
          <div className="keys-table" style={{ marginBottom: 20 }}>
            {prof.targets.map((tg) => (
              <div key={tg.id} className="kr">
                <span className="dot" style={{ background: tg.color, borderRadius: 3 }} />
                <span className="ellipsis">{tg.name}</span>
                <span className="ks">
                  <KeyCap k={tg.key} />
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-label">{t('keys.mouse')}</div>
      <div className="card" style={{ padding: '6px 0', marginBottom: 20 }}>
        {(['keys.mouse.wheel', 'keys.mouse.dbl', 'keys.mouse.drag', 'keys.mouse.swipe', 'keys.mouse.grid', 'keys.mouse.right'] as TKey[]).map((k) => (
          <div key={k} className="setting-row" style={{ padding: '9px 16px' }}>
            {t(k, { mod })}
          </div>
        ))}
      </div>

      <div className="section-label">{t('faq.title')}</div>
      <div className="card">
        {[6, 1, 2, 3, 4, 5].map((n) => (
          <details key={n} className="setting-row" style={{ display: 'block', cursor: 'pointer' }}>
            <summary style={{ fontWeight: 600 }}>{t(`faq.${n}.q` as TKey)}</summary>
            <div className="muted" style={{ marginTop: 6, cursor: 'text', userSelect: 'text' }}>
              {t(`faq.${n}.a` as TKey)}
            </div>
          </details>
        ))}
      </div>
    </>
  );
}

/** Startseite mit allen Apps von SlimBit Apps */
const WEBSITE_URL = 'https://slimbitapps.github.io/';

function AboutTab() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    window.api.appInfo().then(setInfo);
  }, []);
  return (
    <>
      <div className="row" style={{ gap: 16, marginBottom: 20 }}>
        <Logo size={64} />
        <div>
          <h3 style={{ marginBottom: 0 }}>{t('app.name')}</h3>
          <div className="muted">{t('about.version', { v: info?.version || '…' })}</div>
          <div className="faint small">{t('app.tagline')}</div>
        </div>
      </div>
      <Group>
        <Row label={t('about.privacy.title')} desc={t('about.privacy')}>
          <IconLock size={18} className="faint" />
        </Row>
        <Row label={t('about.safety.title')} desc={t('about.safety')}>
          <IconCheck size={18} style={{ color: 'var(--success)' }} />
        </Row>
      </Group>

      <div className="section-label">{t('about.more')}</div>
      <button
        className="app-card link"
        style={{ marginBottom: 20 }}
        onClick={() => window.api.openExternal(WEBSITE_URL)}
        {...tip(t('about.website'), WEBSITE_URL)}
      >
        <div className="row" style={{ gap: 12 }}>
          <img src={slimbitMark} alt="" width={36} height={36} />
          <div className="grow">
            <div style={{ fontWeight: 620 }}>{t('about.website')}</div>
            <div className="small faint">{t('about.website.desc')}</div>
          </div>
          <span className="small" style={{ color: 'var(--accent)', fontWeight: 600 }}>
            {WEBSITE_URL.replace(/^https:\/\//, '').replace(/\/$/, '')} ↗
          </span>
        </div>
      </button>
      <div className="row small faint" style={{ justifyContent: 'space-between' }}>
        <span>{t('about.copyright', { year: new Date().getFullYear() })}</span>
        <span>
          {info?.platform} · {info?.arch}
        </span>
      </div>
    </>
  );
}
