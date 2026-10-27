import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useStore, openDialog, prefs } from '../store';
import { useAi, send, toggleChat, clearChat, openResult } from '../ai';
import { thumbUrl } from '../util';
import { IconClose, IconSend, IconSparkle, IconRefresh } from '../icons';

const EXAMPLES = ['ai.ex1', 'ai.ex2', 'ai.ex3', 'ai.ex4'] as const;

/** Ausblendbare Chat-Leiste rechts: Fotos beschreiben, suchen, verschieben, sortieren lassen. */
export function ChatPanel() {
  const msgs = useAi((a) => a.msgs);
  const busy = useAi((a) => a.busy);
  const status = useAi((a) => a.status);
  const session = useStore((s) => s.session);
  const enabled = useStore((s) => s.settings.prefs.aiEnabled);
  const [text, setText] = useState('');
  const [hist, setHist] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [msgs.length, busy]);
  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = (v = text) => {
    if (!v.trim() || busy) return;
    send(v);
    setHist([v, ...hist.filter((x) => x !== v)].slice(0, 30));
    setHi(-1);
    setText('');
  };

  const ready = enabled && status?.installed;
  const indexing = ready && status && status.total > 0 && status.indexed < status.total;

  return (
    <aside className="chat" data-testid="chat" aria-label={t('ai.chatTitle')}>
      <div className="chat-head">
        <IconSparkle size={17} className="chat-spark" />
        <div className="chat-title">
          <b>{t('ai.chatTitle')}</b>
          <span className="muted small" data-testid="chat-status">
            {!enabled
              ? t('ai.stateOff')
              : !status?.installed
                ? t('ai.stateNoModel')
                : indexing
                  ? t('ai.stateIndexing', { done: status!.indexed, total: status!.total })
                  : t('ai.stateReady')}
          </span>
        </div>
        <button className="btn icon ghost sm" onClick={clearChat} data-tip={t('ai.chatClear')} aria-label={t('ai.chatClear')}>
          <IconRefresh size={15} />
        </button>
        <button className="btn icon ghost sm" onClick={() => toggleChat(false)} data-tip={t('ai.chatHide')} aria-label={t('ai.chatHide')} data-testid="chat-close">
          <IconClose size={15} />
        </button>
      </div>
      {indexing && (
        <div className="chat-progress">
          <i style={{ width: `${(100 * status!.indexed) / Math.max(1, status!.total)}%` }} />
        </div>
      )}
      <div className="chat-list" ref={list}>
        {msgs.map((m) => (
          <div key={m.id} className={`msg ${m.from}`} data-testid={`msg-${m.from}`}>
            <div className="bubble">
              {m.text.split('\n').map((l, i) => (
                <p key={i}>{l}</p>
              ))}
              {m.ids && m.ids.length > 0 && session && (
                <div className="msg-thumbs">
                  {m.ids.map((id) => {
                    const it = session.byId.get(id);
                    if (!it) return null;
                    return (
                      <button key={id} className="msg-thumb" onClick={() => openResult(id)} title={it.name} data-testid="chat-thumb">
                        <img src={thumbUrl(it.path, 256)} alt="" loading="lazy" draggable={false} />
                      </button>
                    );
                  })}
                </div>
              )}
              {m.actions && (
                <div className="msg-actions">
                  {m.actions.map((a, i) => (
                    <button key={i} className={`btn sm ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}`} onClick={a.run}>
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="msg ai">
            <div className="bubble typing">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
        {msgs.length <= 1 && (
          <div className="chat-examples">
            {EXAMPLES.map((k) => (
              <button key={k} className="chip" onClick={() => submit(t(k))}>
                {t(k)}
              </button>
            ))}
          </div>
        )}
      </div>
      {!ready && (
        <div className="chat-note">
          <span>{enabled ? t('ai.noteNoModel') : t('ai.noteOff')}</span>
          <button className="btn sm primary" onClick={() => openDialog({ type: 'settings', tab: 'ai' })}>
            {t('ai.actEnable')}
          </button>
        </div>
      )}
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={input}
          rows={1}
          value={text}
          placeholder={t('ai.placeholder')}
          data-testid="chat-input"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            } else if (e.key === 'ArrowUp' && !text && hist.length) {
              e.preventDefault();
              const n = Math.min(hist.length - 1, hi + 1);
              setHi(n);
              setText(hist[n]);
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              if (text) setText('');
              else toggleChat(false);
            }
          }}
        />
        <button className="btn icon primary" type="submit" disabled={!text.trim() || busy} aria-label={t('ai.send')} data-testid="chat-send">
          <IconSend size={16} />
        </button>
      </form>
      {prefs().aiEnabled && <div className="chat-foot muted">{t('ai.private')}</div>}
    </aside>
  );
}
