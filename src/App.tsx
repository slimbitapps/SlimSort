import { useEffect, useState } from 'react';
import { t } from './i18n';
import {
  useStore, init, closeDialog, setZen, clearSelection, openDialog, undo, selectAll, toggleFullscreen,
  toggleView, step, jumpEdge, skipCurrent, trashCurrent, otherFolder, findTargetByKey, sortToTarget,
  runQuickStart, toast, dismissToast,
} from './store';
import { TopBar } from './components/TopBar';
import { StartScreen } from './components/StartScreen';
import { Session } from './components/Session';
import { Dialogs } from './components/dialogs';
import { KeyCap } from './components/ui';
import { gridNav } from './components/GridView';
import { zoomCommand } from './components/SingleView';
import { isTyping, keyFromEvent, isMac } from './util';
import { IconCheck, IconClose, IconInfo, IconWarning } from './icons';

/** Zentrale Tastatursteuerung */
function onKeyDown(e: KeyboardEvent) {
  const st = useStore.getState();
  const mod = e.ctrlKey || e.metaKey;

  if (e.key === 'Escape') {
    // Vollbild beendet zusätzlich der Hauptprozess selbst – doppelt hält besser.
    if (st.fullscreen) window.api.setFullscreen(false);
    if (st.dialog) closeDialog();
    else if (st.zen) setZen(false);
    else clearSelection();
    return;
  }
  if (st.dialog || isTyping(e)) return;

  if (e.key === 'F1' || (mod && e.key === '/')) {
    e.preventDefault();
    openDialog({ type: 'shortcuts' });
    return;
  }
  if (e.key === 'F11' || (isMac() && e.metaKey && e.ctrlKey && e.key.toLowerCase() === 'f')) {
    e.preventDefault();
    toggleFullscreen();
    return;
  }

  if (st.screen === 'start') {
    if (!mod && !e.altKey && /^[1-9]$/.test(e.key)) {
      const q = st.settings.quickStarts[Number(e.key) - 1];
      if (q) {
        e.preventDefault();
        runQuickStart(q);
      }
    }
    return;
  }

  const s = st.session;
  if (!s) return;

  if (mod) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (k === 'a') {
      e.preventDefault();
      selectAll();
    } else if (k === '0') {
      e.preventDefault();
      zoomCommand('reset');
    }
    return;
  }
  if (e.altKey) return;

  const grid = s.view === 'grid';
  switch (e.key) {
    case 'F10':
      e.preventDefault();
      setZen(!st.zen);
      return;
    case 'Tab':
      e.preventDefault();
      toggleView();
      return;
    case 'ArrowRight':
      e.preventDefault();
      step(1);
      return;
    case 'ArrowLeft':
      e.preventDefault();
      step(-1);
      return;
    case 'ArrowDown':
      if (grid) {
        e.preventDefault();
        step(gridNav.cols);
      }
      return;
    case 'ArrowUp':
      if (grid) {
        e.preventDefault();
        step(-gridNav.cols);
      }
      return;
    case 'Home':
      e.preventDefault();
      jumpEdge(false);
      return;
    case 'End':
      e.preventDefault();
      jumpEdge(true);
      return;
    case '+':
    case '=':
      zoomCommand('in');
      return;
    case '-':
      zoomCommand('out');
      return;
  }

  // Ab hier: Aktionen, die Dateien bewegen – nie durch gedrückt gehaltene Taste wiederholen.
  if (e.key === ' ') {
    e.preventDefault();
    if (!e.repeat) skipCurrent();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    if (!e.repeat) trashCurrent();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (!e.repeat) otherFolder();
    return;
  }
  const k = keyFromEvent(e);
  if (k) {
    e.preventDefault();
    if (e.repeat) return;
    const target = findTargetByKey(k);
    if (target) sortToTarget(target.id);
    else toast('info', t('toast.noTargetKey', { key: k }), { timeout: 1600 });
  }
}

function useTheme() {
  const theme = useStore((s) => s.settings.prefs.theme);
  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" data-testid="toasts">
      {toasts.map((x) => (
        <div key={x.id} className={`toast ${x.kind}`} role="status">
          <span className="ti">
            {x.kind === 'error' ? <IconWarning size={17} /> : x.kind === 'success' ? <IconCheck size={17} /> : <IconInfo size={17} />}
          </span>
          <span>{x.text}</span>
          {x.action && (
            <button
              className="btn primary"
              onClick={() => {
                x.action!.run();
                dismissToast(x.id);
              }}
            >
              {x.action.label}
            </button>
          )}
          <button className="btn icon ghost" onClick={() => dismissToast(x.id)} aria-label={t('common.close')}>
            <IconClose size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Flash() {
  const f = useStore((s) => s.flash);
  if (!f) return null;
  return (
    <div key={f.n} className="flash" style={{ ['--c' as string]: f.color }} data-testid="flash">
      <KeyCap k={f.key} />
      {f.name}
    </div>
  );
}

export function App() {
  const ready = useStore((s) => s.ready);
  const screen = useStore((s) => s.screen);
  const zen = useStore((s) => s.zen);
  const scanning = useStore((s) => s.scanning);
  useStore((s) => s.settings.prefs.lang); // neu zeichnen bei Sprachwechsel
  const [mouseMoved, setMouseMoved] = useState(false);
  useTheme();

  useEffect(() => {
    init();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Im Modus "Nur Bild" Mauszeiger nach kurzer Zeit ausblenden
  useEffect(() => {
    if (!zen) return;
    let timer: ReturnType<typeof setTimeout>;
    const onMove = () => {
      setMouseMoved(true);
      clearTimeout(timer);
      timer = setTimeout(() => setMouseMoved(false), 1500);
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      clearTimeout(timer);
    };
  }, [zen]);

  if (!ready) return null;
  return (
    <div className={`app ${zen ? 'zen' : ''} ${mouseMoved ? 'mouse-moved' : ''}`}>
      <TopBar />
      {screen === 'start' ? <StartScreen /> : <Session />}
      <Dialogs />
      <Toasts />
      <Flash />
      {scanning !== null && (
        <div className="scan-overlay">
          <div className="card row" style={{ gap: 14 }}>
            <div className="spinner" />
            {t('start.scanning', { n: scanning.toLocaleString() })}
          </div>
        </div>
      )}
    </div>
  );
}
