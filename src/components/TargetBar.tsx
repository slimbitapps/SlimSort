import { useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import {
  useStore, activeProfile, sortToTarget, trashCurrent, pickAndAddTarget, openDialog, updateTarget,
  removeTarget, reorderTarget, groupTargets, updateGroup, dissolveGroup, moveTargetToEnd,
  suggestionFor, currentItem, type SessionState,
} from '../store';
import type { Group, Target } from '../types';
import { COLORS, basename, fmtNum } from '../util';
import {
  IconPlus, IconTrash, IconWarning, IconFolder, IconKeyboard, IconChevronDown, IconChevronRight,
} from '../icons';
import { Floating, KeyCap } from './ui';

type Menu =
  | { kind: 'target'; target: Target; x: number; y: number }
  | { kind: 'group'; group: Group; x: number; y: number };

type DropZone = { id: string; zone: 'before' | 'after' | 'into' } | null;

export function TargetBar({ s }: { s: SessionState }) {
  useStore((st) => st.settings.profiles); // neu zeichnen, wenn Ziele sich ändern
  const reach = useStore((st) => st.reach);
  const profile = activeProfile();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropZone>(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestion = suggestionFor(s, currentItem(s));

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

  const openMenuAt = (m: Menu) => setMenu(m);

  const pressHandlers = (onLong: (x: number, y: number) => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      const { clientX, clientY } = e;
      longPress.current = setTimeout(() => onLong(clientX, clientY), 550);
    },
    onPointerUp: () => longPress.current && clearTimeout(longPress.current),
    onPointerLeave: () => longPress.current && clearTimeout(longPress.current),
  });

  const zoneOf = (e: React.DragEvent, allowInto: boolean): 'before' | 'after' | 'into' => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const rel = (e.clientX - r.left) / r.width;
    if (!allowInto) return rel < 0.5 ? 'before' : 'after';
    return rel < 0.28 ? 'before' : rel > 0.72 ? 'after' : 'into';
  };

  const renderTarget = (tg: Target) => {
    const offline = reach[tg.path] === false;
    const count = s.counts[tg.id] || 0;
    const dz = drop && drop.id === tg.id ? `drop-${drop.zone}` : '';
    return (
      <div
        key={tg.id + ':' + count}
        className={`target ${offline ? 'offline' : ''} ${suggestion === tg.id ? 'suggest' : ''} ${count ? 'hit' : ''} ${dz}`}
        style={{ ['--c' as string]: tg.color }}
        role="button"
        tabIndex={-1}
        data-testid="target"
        data-name={tg.name}
        title={`${tg.name}\n${tg.path}${offline ? '\n⚠ ' + t('targets.offline') : ''}`}
        draggable
        onClick={() => sortToTarget(tg.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenuAt({ kind: 'target', target: tg, x: e.clientX, y: e.clientY });
        }}
        {...pressHandlers((x, y) => openMenuAt({ kind: 'target', target: tg, x, y }))}
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
          const zone = zoneOf(e, true);
          if (!drop || drop.id !== tg.id || drop.zone !== zone) setDrop({ id: tg.id, zone });
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!dragId || dragId === tg.id) return;
          const zone = zoneOf(e, true);
          if (zone === 'into') groupTargets(dragId, tg.id);
          else reorderTarget(dragId, tg.id, zone === 'after', tg.groupId ?? null);
          setDrop(null);
          setDragId(null);
        }}
      >
        {suggestion === tg.id && <span className="sugg">{t('single.suggest')}</span>}
        <div className="tname ellipsis">{tg.name}</div>
        <div className="tfoot">
          <KeyCap k={tg.key} />
          {offline && <IconWarning size={14} style={{ color: 'var(--danger)' }} />}
          <span className="count" data-testid="target-count">
            {fmtNum(count)}
          </span>
        </div>
      </div>
    );
  };

  const renderGroup = (g: Group, members: Target[]) => {
    const sum = members.reduce((a, m) => a + (s.counts[m.id] || 0), 0);
    const hasSuggestion = members.some((m) => m.id === suggestion);
    const anyOffline = members.some((m) => reach[m.path] === false);
    return (
      <div key={g.id} className={`group ${g.collapsed ? 'closed' : ''}`} data-testid="group">
        <div
          className={`ghead ${hasSuggestion ? 'suggest' : ''}`}
          onClick={() => updateGroup(g.id, { collapsed: !g.collapsed })}
          onContextMenu={(e) => {
            e.preventDefault();
            openMenuAt({ kind: 'group', group: g, x: e.clientX, y: e.clientY });
          }}
          {...pressHandlers((x, y) => openMenuAt({ kind: 'group', group: g, x, y }))}
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
            <span className="tname ellipsis" style={{ fontWeight: 600, fontSize: 13 }}>
              {g.name}
            </span>
            {anyOffline && <IconWarning size={13} style={{ color: 'var(--danger)' }} />}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <div className="gdots">
              {members.slice(0, 6).map((m) => (
                <i key={m.id} style={{ background: m.color }} />
              ))}
            </div>
            {g.collapsed && (
              <div className="gkeys">
                {members.slice(0, 5).map((m) => (
                  <KeyCap key={m.id} k={m.key} />
                ))}
              </div>
            )}
            <span className="count" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-2)' }}>
              {fmtNum(sum)}
            </span>
          </div>
        </div>
        {!g.collapsed && members.map(renderTarget)}
      </div>
    );
  };

  return (
    <div
      className="targetbar"
      data-testid="targetbar"
      onDragOver={(e) => dragId && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (dragId) moveTargetToEnd(dragId);
        setDragId(null);
        setDrop(null);
      }}
    >
      <div
        className="target trash"
        role="button"
        data-testid="target-trash"
        onClick={() => trashCurrent()}
        title={t('tb.delete')}
      >
        <div className="tname row" style={{ gap: 6 }}>
          <IconTrash size={14} />
          {t('targets.trash')}
        </div>
        <div className="tfoot">
          <KeyCap k={window.api.platform === 'darwin' ? '⌫' : t('key.del')} />
          <span className="count">{fmtNum(s.deleted)}</span>
        </div>
      </div>

      {blocks.map((b) => (b.type === 't' ? renderTarget(b.target) : renderGroup(b.group, b.members)))}

      <div className="target add" role="button" onClick={pickAndAddTarget} data-testid="add-target">
        <IconPlus size={16} />
        {t('targets.add')}
      </div>
      {profile.targets.length === 0 && (
        <div className="target-hint">
          <span>{t('targets.addHint')}</span>
        </div>
      )}
      <div className="row" style={{ alignSelf: 'center', paddingRight: 4 }}>
        <HelpTargets />
      </div>

      {menu && menu.kind === 'target' && (
        <TargetMenu menu={menu} onClose={() => setMenu(null)} />
      )}
      {menu && menu.kind === 'group' && (
        <Floating x={menu.x} y={menu.y} anchorBottom className="menu-pop" onClose={() => setMenu(null)}>
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

function HelpTargets() {
  // Hilfe zur Zielleiste – Text steht in targets.help
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        className="help-btn"
        aria-label={t('common.help')}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setOpen(open ? null : { x: r.left - 300, y: r.top - 10 });
        }}
      >
        ?
      </button>
      {open && (
        <Floating x={open.x} y={open.y} anchorBottom className="help-pop" onClose={() => setOpen(null)}>
          <h4>{t('targets.add')}</h4>
          {t('targets.help')}
        </Floating>
      )}
    </>
  );
}

function TargetMenu({ menu, onClose }: { menu: Extract<Menu, { kind: 'target' }>; onClose: () => void }) {
  const tg = menu.target;
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Floating x={menu.x} y={menu.y} anchorBottom className="menu-pop" onClose={onClose}>
      <div className="row small muted" style={{ padding: '6px 10px' }}>
        <KeyCap k={tg.key} />
        <span className="ellipsis" style={{ maxWidth: 200 }}>
          {tg.name}
        </span>
      </div>
      <div className="msep" />
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
      <div className="small faint" style={{ padding: '6px 10px 0' }}>
        {t('targets.menu.color')}
      </div>
      <div className="colors">
        {COLORS.map((c) => (
          <button
            key={c}
            className={c === tg.color ? 'on' : ''}
            style={{ background: c }}
            aria-label={c}
            onClick={run(() => updateTarget(tg.id, { color: c }))}
          />
        ))}
      </div>
      <div className="msep" />
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
      <div className="msep" />
      <button className="mi danger" onClick={run(() => removeTarget(tg.id))}>
        {t('targets.menu.remove')}
      </button>
    </Floating>
  );
}

