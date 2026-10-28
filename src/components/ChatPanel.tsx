import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useStore, openDialog, prefs } from '../store';
import { useAi, send, toggleChat, clearChat, openResult, stopLlm, llmOn, currentTier, openChat } from '../ai';
import { cleanAnswer } from '../assistant';
import type { Intent } from '../chat';
import { thumbUrl } from '../util';
import { getLang } from '../i18n';
import { useChats, deleteChat, when } from '../chats';
import { displayName } from '../people';
import { IconClose, IconSend, IconSparkle, IconStop, IconHistory, IconPlusChat, IconTrash } from '../icons';

const EXAMPLES = ['ai.ex1', 'ai.ex2', 'ai.ex3', 'ai.ex4'] as const;

/** Ausblendbare Chat-Leiste rechts: Fotos beschreiben, suchen, verschieben, sortieren lassen. */
export function ChatPanel() {
  const msgs = useAi((a) => a.msgs);
  const busy = useAi((a) => a.busy);
  const busyText = useAi((a) => a.busyText);
  // Antwort wird sichtbar geschrieben (ein Werkzeug-Aufruf davor bleibt unsichtbar → Punkte zeigen)
  const streaming = useAi((a) => a.msgs.some((m) => m.streaming && cleanAnswer(m.text).trim()));
  const chats = useChats((c) => c.list);
  const currentChat = useChats((c) => c.current);
  const [showHist, setShowHist] = useState(false);
  const facesOn = useStore((s) => s.settings.prefs.aiFaces);
  const persons = useStore((s) => s.settings.people) || [];
  const memCount = useStore((s) => (s.settings.aiMemory || []).length);
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
  }, [msgs.length, busy, msgs[msgs.length - 1]?.text.length]);
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
                  : status!.facesPending > 0 && status!.facesReady
                    ? t('faces.pending', { n: status!.facesPending })
                  : llmOn()
                    ? t(currentTier() === 'max' ? 'ai.stateReadyMax' : 'ai.stateReadyLlm')
                    : t('ai.stateReady')}
          </span>
        </div>
        <button
          className={`btn icon ghost sm ${showHist ? 'on' : ''}`}
          onClick={() => setShowHist(!showHist)}
          data-tip={t('chat.history')}
          aria-label={t('chat.history')}
          data-testid="chat-history-btn"
        >
          <IconHistory size={15} />
        </button>
        <button
          className="btn icon ghost sm"
          onClick={() => {
            clearChat();
            setShowHist(false);
          }}
          data-tip={t('chat.new')}
          aria-label={t('chat.new')}
          data-testid="chat-new"
        >
          <IconPlusChat size={15} />
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
      {showHist && (
        <div className="chat-history" data-testid="chat-history">
          <button
            className="chat-history-item"
            onClick={() => {
              clearChat();
              setShowHist(false);
            }}
          >
            <IconPlusChat size={16} />
            <span className="grow ttl">{t('chat.new')}</span>
          </button>
          {!chats.length && <p className="muted small" style={{ padding: 10 }}>{t('chat.none')}</p>}
          {chats.map((c) => (
            <div key={c.id} className={`chat-history-item ${c.id === currentChat ? 'on' : ''}`} data-testid="chat-history-item">
              <button
                className="grow"
                style={{ all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0 }}
                onClick={() => {
                  openChat(c.id);
                  setShowHist(false);
                }}
              >
                <div className="ttl">{c.title || t('chat.untitled')}</div>
                <div className="when">
                  {when(c.updated, getLang())} · {t('chat.msgCount', { n: c.msgs.length })}
                </div>
              </button>
              <button className="btn icon ghost sm" onClick={() => deleteChat(c.id)} aria-label={t('chat.delete')} data-tip={t('chat.delete')}>
                <IconTrash size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="chat-list" ref={list}>
        {msgs
          .filter((m) => !(m.streaming && !cleanAnswer(m.text).trim() && !m.ids?.length && !m.faces?.length))
          .map((m) => (
          <div key={m.id} className={`msg ${m.from}`} data-testid={`msg-${m.from}`}>
            <div className={`bubble ${m.streaming ? 'streaming' : ''}`}>
              {(m.from === 'ai' ? cleanAnswer(m.text) : m.text).split('\n').map((l, i) => (
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
              {!m.ids?.length && m.paths && m.paths.length > 0 && (
                <div className="msg-thumbs">
                  {m.paths.map((p) => (
                    <span key={p} className="msg-thumb" title={p}>
                      <img src={thumbUrl(p, 256)} alt="" loading="lazy" draggable={false} />
                    </span>
                  ))}
                </div>
              )}
              {m.faces && m.faces.length > 0 && (
                <div className="msg-faces" data-testid="chat-faces">
                  {m.faces.map((f, i) => (
                    <div key={i} className="msg-face">
                      {f.src ? <img className="face-img" src={f.src} alt="" /> : <div className="face-img face-initial">?</div>}
                      {f.label && <span>{f.label}</span>}
                    </div>
                  ))}
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
        {busy && !streaming && (
          <div className="msg ai">
            <div className="bubble typing">
              <i />
              <i />
              <i />
              {busyText && <span className="busy-text">{busyText}</span>}
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
      {ready && !busy && msgs.length > 1 && !text && (
        <div className="chat-suggest" data-testid="chat-suggest">
          {(
            [
              ...(session && facesOn ? [{ label: t('sugg.whoIs'), it: { kind: 'whois', ref: 'current' } }] : []),
              ...(session && facesOn && persons.length ? [{ label: t('sugg.photosWith', { name: displayName(persons[0]) }), it: { kind: 'search', query: persons[0].me ? 'ich' : persons[0].name } }] : []),
              ...(session && facesOn ? [{ label: t('sugg.unknown'), it: { kind: 'unknownFaces' } }] : []),
              ...(session ? [{ label: t('sugg.similar'), it: { kind: 'similar' } }, { label: t('sugg.autosort'), it: { kind: 'autosort' } }] : []),
              ...(memCount ? [{ label: t('sugg.memories'), it: { kind: 'memories' } }] : []),
            ] as { label: string; it: Intent }[]
          ).map((x) => (
            <button key={x.label} className="chip" onClick={() => send(x.label, x.it)}>
              {x.label}
            </button>
          ))}
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
        {busy ? (
          <button className="btn icon" type="button" onClick={stopLlm} aria-label={t('ai.stop')} data-tip={t('ai.stop')} data-testid="chat-stop">
            <IconStop size={15} />
          </button>
        ) : (
          <button className="btn icon primary" type="submit" disabled={!text.trim()} aria-label={t('ai.send')} data-testid="chat-send">
            <IconSend size={16} />
          </button>
        )}
      </form>
      {prefs().aiEnabled && <div className="chat-foot muted">{t('ai.private')}</div>}
    </aside>
  );
}
