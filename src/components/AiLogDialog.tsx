import { useState } from 'react';
import { t, getLang } from '../i18n';
import { useStore, goTo, setView, closeDialog } from '../store';
import { useAiLog, undoEntry, undoPhoto, type LogEntry } from '../ailog';
import { Dialog } from './ui';
import { thumbUrl } from '../util';
import { IconHistory, IconChevronDown, IconChevronRight, IconUndo, IconFolder, IconTrash, IconSettings, IconBrain, IconUsers, IconTag, IconMove } from '../icons';

const ICON: Record<LogEntry['kind'], typeof IconMove> = {
  move: IconMove,
  delete: IconTrash,
  folder: IconFolder,
  setting: IconSettings,
  memory: IconBrain,
  people: IconUsers,
  things: IconTag,
  learn: IconBrain,
};

/** KI-Verlauf: was die KI geändert hat – gebündelt, aufklappbar bis zum einzelnen Foto, alles rückgängig */
export function AiLogDialog() {
  const entries = useAiLog((l) => l.entries);
  return (
    <Dialog title={t('log.title')} icon={<IconHistory size={20} />} size="wide" testId="ailog-dialog">
      <p className="muted" style={{ marginTop: 0 }}>
        {t('log.intro')}
      </p>
      {!entries.length ? (
        <p className="muted small" data-testid="ailog-empty">
          {t('log.empty')}
        </p>
      ) : (
        <div className="log-list">
          {entries.map((e) => (
            <Entry key={e.id} e={e} />
          ))}
        </div>
      )}
    </Dialog>
  );
}

function Entry({ e }: { e: LogEntry }) {
  const [open, setOpen] = useState(false);
  const session = useStore((s) => s.session);
  const Icon = ICON[e.kind];
  const photos = e.photos || [];
  const left = photos.filter((p) => !p.undone).length;
  const time = new Date(e.time).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' });
  const canUndo = !e.undone && (photos.length ? !!session && left > 0 : !!e.revert);
  return (
    <div className={`log-entry ${e.undone ? 'undone' : ''}`} data-testid="ailog-entry">
      <div className="log-head">
        {photos.length > 0 ? (
          <button className="btn icon ghost sm" onClick={() => setOpen(!open)} aria-label={t('log.details')} data-testid="ailog-expand">
            {open ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}
          </button>
        ) : (
          <span style={{ width: 30 }} />
        )}
        <Icon size={16} className="log-icon" />
        <div className="grow">
          <div className="log-title">{e.title}</div>
          <div className="log-meta">
            {time}
            {e.source ? ` · ${e.source}` : ''}
            {e.undone ? ` · ${t('log.wasUndone')}` : photos.length && left < photos.length ? ` · ${t('log.partly', { n: photos.length - left })}` : ''}
          </div>
        </div>
        {canUndo && (
          <button className="btn sm" onClick={() => undoEntry(e)} data-testid="ailog-undo">
            <IconUndo size={14} />
            {photos.length > 1 ? t('log.undoAll', { n: left }) : t('ai.undo')}
          </button>
        )}
      </div>
      {open && (
        <div className="log-photos">
          {photos.map((p) => (
            <div key={p.id} className={`log-photo ${p.undone ? 'undone' : ''}`} data-testid="ailog-photo">
              <button
                className="log-thumb"
                onClick={() => {
                  if (!session?.byId.has(p.id)) return;
                  goTo(p.id, { select: true });
                  setView('single');
                  closeDialog();
                }}
                title={p.name}
              >
                <img src={thumbUrl(p.path, 128)} alt="" loading="lazy" />
              </button>
              <div className="grow">
                <div className="ellipsis">{p.name}</div>
                <div className="log-meta">{p.undone ? t('log.wasUndone') : e.kind === 'delete' ? t('log.toTrash') : `→ ${p.to || ''}`}</div>
              </div>
              {!p.undone && session && (
                <button className="btn ghost sm" onClick={() => undoPhoto(e, p.id)} data-testid="ailog-undo-photo" aria-label={t('ai.undo')} data-tip={t('ai.undo')}>
                  <IconUndo size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
