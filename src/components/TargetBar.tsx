import { useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import {
  useStore, activeProfile, sortToTarget, trashCurrent, skipCurrent, pickAndAddTarget, openDialog, updateTarget,
  removeTarget, reorderTarget, groupTargets, updateGroup, dissolveGroup, moveTargetToEnd, suggestionFor, currentItem,
  type SessionState,
} from '../store';
import type { Group, Target } from '../types';
import { COLORS, basename, fmtNum } from '../util';
import { IconPlus, IconTrash, IconWarning, IconFolder, IconKeyboard, IconChevronDown, IconChevronRight, IconSkip } from '../icons';
import { Floating, Help, KeyCap } from './ui';

type Menu =
  | { kind: 'target'; target: Target; x: number; y: number }
  | { kind: 'group'; group: Group; x: number; y: number };

type DropZone = { id: string; zone: 'before' | 'after' | 'into' } | null;

/** Untere Leiste: Überspringen, Löschen und alle Zielordner. */
export function Dock({ s }: { s: SessionState }) {
  useStore((st) => st.settings.profiles); // neu zeichnen, wenn Ziele sich ändern
  const reach = useStore((st) => st.reach);
  const profile = activeProfile();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropZone>(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestion = suggestionFor(s, currentItem(s));
  const mac = window.api.platform === 'darwin';

  // Gruppen an der Stelle ihres ersten Mitglieds einfügen
  const blocks = useMemo(() => {
    const out: ({ type: 't'; target: Target } | { type: 'g'; group: Group; members: Target[] })[] = [];
    const seen = new Set<string>();
    for (const tg of profile.targets) {
      if (tg.groupId) {
        if (seen.has(tg.groupId)) continue;
        const g = profile.groups.find((x) => x.id === tg.groupId);
        if (g) {
          seen.add(g.id);
          out.push({ type: 'g', group: g, members: profile.targets.filter((x) => x.groupId === g.id) });
          continue;
        }
      }
      out.push({ type: 't', target: tg });
    }
    return out;
  }, [profile]);

  const pressHandlers = (onLong: (x: number, y: number) => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      const { clientX, clientY } = e;
      longPress.current = setTimeout(() => onLong(clientX, clientY), 550);
    },
    onPointerUp: () => longPress.current && clearTimeout(longPress.current),
    onPointerLeave: () => longPress.current && clearTimeout(longPress.current),
  });

  const zoneOf = (e: React.DragEvent): 'before' | 'after' | 'into' => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const rel = (e.clientX - r.left) / r.width;
    return rel < 0.28 ? 'before' : rel > 0.72 ? 'after' : 'into';
  };

  const renderTarget = (tg: Target) => {
    const offline = reach[tg.path] === false;
    const count = s.counts[tg.id] || 0;
    const dz = drop && drop.id === tg.id ? `drop-${drop.zone}` : '';
    return (
      <button
        key={tg.id + ':' + count}
        className={`target ${offline ? 'offline' : ''} ${suggestion === tg.id ? 'suggest' : ''} ${count ? 'hit' : ''} ${dz}`}
        style={{ ['--c' as string]: tg.color }}
        data-testid="target"
        data-name={tg.name}
        title={`${tg.name}\n${tg.path}${offline ? '\n⚠ ' + t('ses.offline') : ''}`}
        draggable
        onClick={() => sortToTarget(tg.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ kind: 'target', target: tg, x: e.clientX, y: e.clientY });
        }}
        {...pressHandlers((x, y) => setMenu({ kind: 'target', target: tg, x, y }))}
        onDragStart={(e) => {
          setDragId(tg.id);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', tg.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setDrop(null);
        }}
        onDragOver={(e) => {
          if (!dragId || dragId === tg.id) return;
          e.preventDefault();
          e.stopPropagation();
          const zone = zoneOf(e);
          if (!drop || drop.id !== tg.id || drop.zone !== zone) setDrop({ id: tg.id, zone });
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!dragId || dragId === tg.id) return;
          const zone = zoneOf(e);
          if (zone === 'into') groupTargets(dragId, tg.id);
          else reorderTarget(dragId, tg.id, zone === 'after', tg.groupId ?? null);
          setDrop(null);
          setDragId(null);
        }}
      >
        {suggestion === tg.id && <span className="sugg">{t('ses.suggest')}</span>}
        <div className="t-top">
          <span className="t-dot" />
          <span className="t-name ellipsis">{tg.name}</span>
          {offline && <IconWarning size={14} style={{ color: 'var(--danger)', flex: 'none' }} />}
        </div>
        <div className="t-foot">
          <KeyCap k={tg.key} />
          <span className="t-count" data-testid="target-count">
            {fmtNum(count)}
          </span>
        </div>
      </button>
    );
  };

  const renderGroup = (g: Group, members: Target[]) => {
    const sum = members.reduce((a, m) => a + (s.counts[m.id] || 0), 0);
    const anyOffline = members.some((m) => reach[m.path] === false);
    return (
      <div key={g.id} className="group" data-testid="group">
        <button
          className="ghead"
          onClick={() => updateGroup(g.id, { collapsed: !g.collapsed })}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ kind: 'group', group: g, x: e.clientX, y: e.clientY });
          }}
          {...pressHandlers((x, y) => setMenu({ kind: 'group', group: g, x, y }))}
          onDragOver={(e) => {
            if (!dragId || members.some((m) => m.id === dragId)) return;
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId) groupTargets(dragId, members[members.length - 1].id);
            setDragId(null);
          }}
          title={members.map((m) => `${m.key || '–'}  ${m.name}`).join('\n')}
        >
          <div className="row" style={{ gap: 4 }}>
            {g.collapsed ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
            <span className="ellipsis" style={{ fontWeight: 620, fontSize: 13 }}>
              {g.name}
            </span>
            {anyOffline && <IconWarning size={13} style={{ color: 'var(--danger)' }} />}
          </div>
          <div className="row" style={{ gap: 6 }}>
            {g.collapsed ? (
              <div className="gkeys">
                {members.slice(0, 5).map((m) => (
                  <KeyCap key={m.id} k={m.key} />
                ))}
              </div>
            ) : (
              <div className="row" style={{ gap: 3 }}>
                {members.slice(0, 6).map((m) => (
                  <span key={m.id} className="dot" style={{ background: m.color, width: 8, height: 8 }} />
                ))}
              </div>
            )}
            <span className="faint small" style={{ marginLeft: 'auto', fontWeight: 600 }}>
              {fmtNum(sum)}
            </span>
          </div>
        </button>
        {!g.collapsed && members.map(renderTarget)}
      </div>
    );
  };

  return (
    <div className="dock" data-testid="targetbar">
      <div className="dock-actions" data-coach="actions">
        <button className="act" onClick={skipCurrent} data-testid="skip" title={`${t('ses.skip')} (${t('key.space')})`}>
          <IconSkip size={18} />
          {t('ses.skip')}
          <KeyCap k={t('key.space')} />
        </button>
        <button className="act delete" onClick={trashCurrent} data-testid="target-trash" title={t('ses.delete.tip')}>
          <IconTrash size={18} />
          {t('ses.delete')}
          <KeyCap k={mac ? '⌫' : t('key.del')} />
        </button>
      </div>
      <div className="dock-sep" />
      <div
        className="targets-scroll"
        data-coach="targets"
        onDragOver={(e) => dragId && e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (dragId) moveTargetToEnd(dragId);
          setDragId(null);
          setDrop(null);
        }}
      >
        {blocks.map((b) => (b.type === 't' ? renderTarget(b.target) : renderGroup(b.group, b.members)))}
        <button className="target add" onClick={pickAndAddTarget} data-testid="add-target">
          <IconPlus size={16} />
          {t('ses.addTarget')}
        </button>
        {profile.targets.length === 0 && <div className="target-hint">{t('ses.noTargets')}</div>}
        <div className="row" style={{ alignSelf: 'center', padding: '0 6px', flex: 'none' }}>
          <Help title={t('setup.targets.title')} text={t('targets.help')} />
        </div>
      </div>

      {menu && menu.kind === 'target' && <TargetMenu menu={menu} onClose={() => setMenu(null)} />}
      {menu && menu.kind === 'group' && (
        <Floating x={menu.x} y={menu.y} anchorBottom className="menu" onClose={() => setMenu(null)}>
          <button
            className="mi"
            onClick={() => {
              const g = menu.group;
              setMenu(null);
              openDialog({ type: 'prompt', title: t('targets.groupRename'), value: g.name, onOk: (v) => updateGroup(g.id, { name: v }) });
            }}
          >
            {t('targets.groupRename')}
          </button>
          <button
            className="mi"
            onClick={() => {
              dissolveGroup(menu.group.id);
              setMenu(null);
            }}
          >
            {t('targets.groupDissolve')}
          </button>
        </Floating>
      )}
    </div>
  );
}

function TargetMenu({ menu, onClose }: { menu: Extract<Menu, { kind: 'target' }>; onClose: () => void }) {
  const tg = menu.target;
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Floating x={menu.x} y={menu.y} anchorBottom className="menu" onClose={onClose}>
      <div className="row small muted" style={{ padding: '6px 10px 8px' }}>
        <KeyCap k={tg.key} />
        <span className="ellipsis" style={{ maxWidth: 200, fontWeight: 600 }}>
          {tg.name}
        </span>
      </div>
      <div className="sep" />
      <button className="mi" onClick={run(() => openDialog({ type: 'keyCapture', targetId: tg.id }))}>
        <IconKeyboard size={16} />
        {t('targets.menu.key')}
      </button>
      <button
        className="mi"
        onClick={run(() =>
          openDialog({ type: 'prompt', title: t('targets.renamePrompt'), value: tg.name, onOk: (v) => updateTarget(tg.id, { name: v }) })
        )}
      >
        {t('targets.menu.rename')}
      </button>
      <div className="mh">{t('targets.menu.color')}</div>
      <div className="colors">
        {COLORS.map((c) => (
          <button key={c} className={c === tg.color ? 'on' : ''} style={{ background: c }} aria-label={c} onClick={run(() => updateTarget(tg.id, { color: c }))} />
        ))}
      </div>
      <div className="sep" />
      <button
        className="mi"
        onClick={run(async () => {
          const d = await window.api.pickFolder({ title: t('targets.menu.folder'), defaultPath: tg.path });
          if (d) updateTarget(tg.id, { path: d, name: tg.name === basename(tg.path) ? basename(d) : tg.name });
        })}
      >
        <IconFolder size={16} />
        {t('targets.menu.folder')}
      </button>
      <button className="mi" onClick={run(() => window.api.openPath(tg.path))}>
        {t('targets.menu.show')}
      </button>
      {tg.groupId && (
        <button className="mi" onClick={run(() => moveTargetToEnd(tg.id))}>
          {t('targets.menu.ungroup')}
        </button>
      )}
      <div className="sep" />
      <button className="mi danger" onClick={run(() => removeTarget(tg.id))}>
        {t('targets.menu.remove')}
      </button>
    </Floating>
  );
}
