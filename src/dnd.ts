/**
 * Ziehen & Ablegen mit Zeiger-Ereignissen (statt HTML-Drag&Drop – das verträgt sich unter
 * Windows nicht mit dem Ablegen von Dateien aus dem Explorer).
 *
 * Ziehbar: Zielordner (zum Umsortieren/Gruppieren) und Fotos (auf einen Zielordner ziehen = einsortieren).
 * Ablageflächen markieren sich mit data-drop="<art>:<id>".
 */
import { useSyncExternalStore } from 'react';

export type DragPayload =
  | { kind: 'target'; id: string; label: string; color: string }
  | { kind: 'photos'; ids: number[]; label: string; thumb?: string };

export interface DragState {
  payload: DragPayload;
  x: number;
  y: number;
  /** Ablagefläche unter dem Zeiger, z. B. "target:tg123" */
  over: string | null;
  zone: 'before' | 'after' | 'into';
}

type DropHandler = (p: DragPayload, over: string, zone: DragState['zone']) => void;

let state: DragState | null = null;
const listeners = new Set<() => void>();
let onDrop: DropHandler | null = null;
let suppressClick = false;

const emit = () => listeners.forEach((l) => l());

export function useDrag() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state
  );
}

/** Zentrale Stelle, die Ablagen ausführt (App setzt sie einmal). */
export function setDropHandler(h: DropHandler) {
  onDrop = h;
}

function dropAt(x: number, y: number): { over: string | null; zone: DragState['zone'] } {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const d = el?.closest('[data-drop]') as HTMLElement | null;
  if (!d) return { over: null, zone: 'into' };
  const r = d.getBoundingClientRect();
  const rel = (x - r.left) / r.width;
  return { over: d.dataset.drop || null, zone: rel < 0.28 ? 'before' : rel > 0.72 ? 'after' : 'into' };
}

/**
 * Beim Drücken aufrufen. Erst ab 6 px Bewegung beginnt das Ziehen – ein normaler Klick bleibt ein Klick.
 * `make` liefert die Nutzlast erst dann (z. B. die aktuelle Auswahl).
 */
export function beginDrag(e: React.PointerEvent, make: () => DragPayload | null) {
  if (e.button !== 0 || e.pointerType === 'touch') return;
  const sx = e.clientX;
  const sy = e.clientY;
  let active = false;
  const move = (ev: PointerEvent) => {
    if (!active) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      const payload = make();
      if (!payload) return cleanup();
      active = true;
      state = { payload, x: ev.clientX, y: ev.clientY, over: null, zone: 'into' };
      document.documentElement.classList.add('dragging');
    }
    const { over, zone } = dropAt(ev.clientX, ev.clientY);
    state = { ...state!, x: ev.clientX, y: ev.clientY, over, zone };
    emit();
  };
  const up = (ev: PointerEvent) => {
    if (active && state) {
      const { over, zone } = dropAt(ev.clientX, ev.clientY);
      const p = state.payload;
      state = null;
      emit();
      suppressClick = true; // der folgende Klick gehört noch zum Ziehen
      setTimeout(() => (suppressClick = false), 0);
      if (over && onDrop) onDrop(p, over, zone);
    }
    cleanup();
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && active) {
      state = null;
      emit();
      cleanup();
    }
  };
  function cleanup() {
    document.documentElement.classList.remove('dragging');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('keydown', key, true);
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('keydown', key, true);
}

/** Klicks unterdrücken, die direkt auf ein Ziehen folgen. */
window.addEventListener(
  'click',
  (e) => {
    if (suppressClick) {
      e.stopPropagation();
      e.preventDefault();
      suppressClick = false;
    }
  },
  true
);
