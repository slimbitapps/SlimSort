import { useEffect, useState } from 'react';
import { t } from './i18n';
import {
  useStore, init, closeDialog, setZen, clearSelection, openDialog, undo, selectAll, toggleFullscreen, toggleView,
  step, jumpEdge, skipCurrent, trashCurrent, otherFolder, findTargetByKey, sortToTarget, runQuickStart, toast,
  dismissToast, sortedRecents, coachNext, coachEnd, goHome, compareSkip, compareConfirm, compareKeepOnly, compareIdAt,
  comparePage, updatePrefs,
} from './store';
import { TooltipLayer } from './components/Tooltip';
import { WindowControls } from './components/WindowControls';
import { DragGhost } from './components/DragGhost';
import { Header } from './components/Header';
import { Onboarding } from './components/Onboarding';
import { Home } from './components/Home';
import { Setup } from './components/Setup';
import { Session } from './components/Session';
import { Dialogs } from './components/dialogs';
import { Coach, COACH_STEPS } from './components/Coach';
import { KeyCap, Spinner } from './components/ui';
import { gridNav } from './components/GridView';
import { zoomCommand } from './components/SingleView';
import { isTyping, keyFromEvent, actionKeyOf, isMac, fmtNum } from './util';
import { IconCheck, IconClose, IconInfo, IconWarning, IconEye } from './icons';

/** Zentrale Tastatursteuerung */
function onKeyDown(e: KeyboardEvent) {
  const st = useStore.getState();
  const mod = e.ctrlKey || e.metaKey;

  // Einführung: nur Weiter/Beenden
  if (st.coach !== null && !st.dialog) {
    if (e.key === 'Enter' || e.key === 'ArrowRight') coachNext(COACH_STEPS.length);
    if (e.key === 'Escape') coachEnd();
    e.preventDefault();
    return;
  }

  if (e.key === 'Escape') {
    // Vollbild beendet zusätzlich der Hauptprozess selbst – doppelt hält besser.
    if (st.fullscreen) window.api.setFullscreen(false);
    if (st.dialog) closeDialog();
    else if (st.zen) setZen(false);
    else if (st.session?.compare) compareSkip();
    else clearSelection();
    return;
  }
  if (st.dialog || isTyping(e)) return;

  if (e.key === 'F1' || (mod && e.key === '/')) {
    e.preventDefault();
    openDialog({ type: 'settings', tab: 'help' });
    return;
  }
  if (e.key === 'F11' || (isMac() && e.metaKey && e.ctrlKey && e.key.toLowerCase() === 'f')) {
    e.preventDefault();
    toggleFullscreen();
    return;
  }

  if (st.screen === 'home') {
    if (!mod && !e.altKey && /^[1-9]$/.test(e.key)) {
      const q = sortedRecents(st.settings.quickStarts)[Number(e.key) - 1];
      if (q) {
        e.preventDefault();
        runQuickStart(q);
      }
    }
    return;
  }

  const s = st.session;
  if (st.screen !== 'session' || !s) return;

  // ---- Vergleich einer Serie
  if (s.compare && !mod) {
    if (e.code && /^(Digit|Numpad)[1-9]$/.test(e.code) && e.shiftKey) {
      // Shift + Zahl: nur dieses Foto behalten
      e.preventDefault();
      const id = compareIdAt(Number(e.code.slice(-1)));
      if (id !== null) compareKeepOnly(id);
      return;
    }
    const K = st.settings.prefs.keys;
    const ak = actionKeyOf(e);
    if (ak && ak === K.skip && ak !== ' ') {
      e.preventDefault();
      if (!e.repeat) compareSkip();
      return;
    }
    if (ak && ak === K.trash && ak !== 'Delete') {
      e.preventDefault();
      if (!e.repeat) compareConfirm();
      return;
    }
    switch (e.key) {
      case 'Escape':
      case ' ':
        e.preventDefault();
        if (!e.repeat) compareSkip();
        return;
      case 'Enter':
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        if (!e.repeat) compareConfirm();
        return;
      case 'ArrowRight':
        e.preventDefault();
        comparePage(1);
        return;
      case 'ArrowLeft':
        e.preventDefault();
        comparePage(-1);
        return;
      case '+':
      case '=':
        zoomCommand('in');
        return;
      case '-':
        zoomCommand('out');
        return;
      case 'Tab':
      case 'F10':
        e.preventDefault();
        return;
    }
    const k = keyFromEvent(e);
    if (k && !e.altKey) {
      e.preventDefault();
      if (e.repeat) return;
      const target = findTargetByKey(k);
      if (target) compareConfirm(target.id);
      else toast('info', t('toast.noTargetKey', { key: k }), { timeout: 1800 });
    }
    return;
  }

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
  // Die Tasten für Überspringen/Löschen/Anderer Ordner sind frei belegbar (Einstellungen → Sortieren).
  const K = st.settings.prefs.keys;
  const ak = actionKeyOf(e);
  if (ak && ak === K.skip) {
    e.preventDefault();
    if (!e.repeat) skipCurrent();
    return;
  }
  if (ak && (ak === K.trash || (K.trash === 'Delete' && ak === 'Backspace'))) {
    e.preventDefault();
    if (!e.repeat) trashCurrent();
    return;
  }
  if (ak && ak === K.other) {
    e.preventDefault();
    if (!e.repeat) otherFolder();
    return;
  }
  const k = keyFromEvent(e);
  if (k) {
    e.preventDefault();
    if (e.repeat) return;
    const target = findTargetByKey(k);
    // I = Info-Anzeige (wenn kein Zielordner diese Taste hat)
    if (!target && k === 'I') return updatePrefs({ showInfo: !st.settings.prefs.showInfo });
    // Shift + Ordner-Taste: die ganze Serie auf einmal
    if (target) sortToTarget(target.id, { wholeSeries: e.shiftKey });
    else toast('info', t('toast.noTargetKey', { key: k }), { timeout: 1800 });
  }
}

function useTheme() {
  const theme = useStore((s) => s.settings.prefs.theme);
  const accent = useStore((s) => s.settings.prefs.accent);
  const viewerBg = useStore((s) => s.settings.prefs.viewerBg);
  const uiScale = useStore((s) => s.settings.prefs.uiScale);
  // v2: Akzentfarbe, Hintergrund hinter den Fotos, Größe der Oberfläche
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.accent = accent;
    el.dataset.viewer = viewerBg;
    el.style.setProperty('zoom', String(uiScale || 1));
  }, [accent, viewerBg, uiScale]);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
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
            {x.kind === 'error' ? <IconWarning size={18} /> : x.kind === 'success' ? <IconCheck size={18} /> : <IconInfo size={18} />}
          </span>
          <span>{x.text}</span>
          {x.action && (
            <button
              className="btn primary sm"
              onClick={() => {
                x.action!.run();
                dismissToast(x.id);
              }}
            >
              {x.action.label}
            </button>
          )}
          <button className="btn icon ghost sm" onClick={() => dismissToast(x.id)} aria-label={t('common.close')}>
            <IconClose size={14} />
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

function Loading() {
  const scanning = useStore((s) => s.scanning);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (scanning === null) return setSlow(false);
    const id = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(id);
  }, [scanning === null]); // eslint-disable-line
  if (scanning === null) return null;
  return (
    <div className="loading-overlay" data-testid="loading">
      <div className="loading-card">
        <Spinner />
        <div style={{ fontWeight: 650, fontSize: 15 }}>{t('loading.title')}</div>
        <div className="muted small">{scanning > 0 ? t('loading.found', { n: fmtNum(scanning) }) : t('loading.wait')}</div>
        {slow && (
          <button className="btn sm" onClick={goHome}>
            {t('common.cancel')}
          </button>
        )}
      </div>
    </div>
  );
}

export function App() {
  const ready = useStore((s) => s.ready);
  const screen = useStore((s) => s.screen);
  const zen = useStore((s) => s.zen);
  const fullscreen = useStore((s) => s.fullscreen);
  useStore((s) => s.settings.prefs.lang); // neu zeichnen bei Sprachwechsel
  const [mouseMoved, setMouseMoved] = useState(false);
  useTheme();

  useEffect(() => {
    init().finally(() => requestAnimationFrame(() => window.api.showWindow()));
    window.addEventListener('keydown', onKeyDown);
    const onErr = (e: ErrorEvent) => window.api.log(`window.error: ${e.message} ${e.error?.stack || ''}`);
    const onRej = (e: PromiseRejectionEvent) => window.api.log(`unhandledrejection: ${e.reason?.stack || e.reason}`);
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
    };
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
  const onboarding = screen === 'onboarding';
  return (
    <div
      className={`app platform-${window.api.platform} ${zen ? 'zen' : ''} ${mouseMoved ? 'mouse-moved' : ''} ${fullscreen ? 'fullscreen' : ''} ${onboarding ? 'no-header' : ''}`}
    >
      {!onboarding && <Header />}
      {screen === 'onboarding' && <Onboarding />}
      {screen === 'home' && <Home />}
      {screen === 'setup' && <Setup />}
      {screen === 'session' && <Session />}
      {zen && (
        <button className="btn zen-exit" onClick={() => setZen(false)}>
          <IconEye size={16} />
          {t('ses.focusExit')}
        </button>
      )}
      {window.api.platform === 'win32' && !fullscreen && !zen && <WindowControls />}
      <Dialogs />
      <Coach />
      <TooltipLayer />
      <DragGhost />
      <Toasts />
      <Flash />
      <Loading />
    </div>
  );
}
