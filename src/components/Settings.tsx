import { useEffect, useState, type ReactNode } from 'react';
import { t, LANGS, type TKey } from '../i18n';
import {
  useStore, closeDialog, updatePrefs, activeProfile, updateSettings, setActiveProfile, openDialog, restartTutorial,
  toast, previewSeriesCount,
} from '../store';
import { tip } from './Tooltip';
import type { AppInfo, Prefs, Profile } from '../types';
import { Help, KeyCap, Logo, Switch, MenuPopup, useMenu } from './ui';
import {
  IconGlobe, IconSliders, IconTrash, IconImage, IconLayers, IconSettings, IconHelp, IconInfo, IconClose, IconCheck,
  IconSparkle, IconLock, IconBook, IconRefresh, IconPlus, IconMore, IconLayers as IconStack,
} from '../icons';
import { modKey, uid } from '../util';

type Tab = 'general' | 'series' | 'sorting' | 'trash' | 'display' | 'sets' | 'advanced' | 'help' | 'about';

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
    ['display', t('settings.display'), <IconImage size={17} key="d" />, expert],
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

function AdvancedTab() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    window.api.appInfo().then(setInfo);
  }, []);
  return (
    <>
      <h3>{t('settings.advanced')}</h3>
      <p className="sub">{t('settings.advanced.sub')}</p>
      <Group>
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
      <div className="apps" style={{ marginBottom: 20 }}>
        {[1, 2, 3].map((n) => (
          <div key={n} className="app-card">
            <div className="ic">{n === 1 ? <IconSparkle size={18} /> : n === 2 ? <IconBook size={18} /> : <IconLayers size={18} />}</div>
            <div style={{ fontWeight: 620 }}>{t('about.placeholder', { n })}</div>
            <div className="small faint">{t('about.placeholder.desc')}</div>
            <div className="small" style={{ color: 'var(--accent)', fontWeight: 600, marginTop: 4 }}>
              {t('about.soon')}
            </div>
          </div>
        ))}
      </div>
      <div className="row small faint" style={{ justifyContent: 'space-between' }}>
        <span>{t('about.copyright', { year: new Date().getFullYear() })}</span>
        <span>
          Electron {info?.electron} · {info?.platform}
        </span>
      </div>
    </>
  );
}
