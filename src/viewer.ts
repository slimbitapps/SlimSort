/**
 * Zweiter Bildschirm: ein eigenes Foto-Fenster zeigt nur das aktuelle Foto/Video (groß, im Vollbild),
 * das Hauptfenster wird zur Steuerung (alle Fotos, große Ordner-Knöpfe, KI).
 * Tasten im Foto-Fenster wirken wie im Hauptfenster.
 */
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { useStore, currentItem, currentIndex, toast } from './store';
import { t } from './i18n';

export interface ViewerShow {
  path: string;
  kind: 'image' | 'video';
  ext: string;
  name: string;
  pos: string;
  videoPlay: string;
}

export const useViewer = create<{ open: boolean }>(() => ({ open: false }));

let wired = false;
let last = '';

function payload(): ViewerShow | null {
  const st = useStore.getState();
  const s = st.session;
  const it = s ? currentItem(s) : null;
  if (!s || !it) return null;
  return {
    path: it.path,
    kind: it.kind === 'video' ? 'video' : 'image',
    ext: it.ext,
    name: it.name,
    pos: `${currentIndex(s) + 1} / ${s.viewIds.length}`,
    videoPlay: st.settings.prefs.videoPlay || 'muted',
  };
}

function send(force = false) {
  if (!useViewer.getState().open) return;
  const p = payload();
  const key = p ? p.path + p.pos + p.videoPlay : '';
  if (!force && key === last) return;
  last = key;
  emitTo('viewer', 'viewer:show', p).catch(() => {});
}

function wire() {
  if (wired) return;
  wired = true;
  useStore.subscribe(() => send());
  listen('viewer:ready', () => send(true));
  listen('viewer:closed', () => useViewer.setState({ open: false }));
  // zurück zur Startseite: Foto-Fenster schließen
  window.addEventListener('fs-home', () => useViewer.getState().open && closeViewer());
  // Tasten aus dem Foto-Fenster: wie hier gedrückt
  listen<{ key: string; code: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }>('viewer:key', (e) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { ...e.payload, bubbles: true, cancelable: true }));
  });
}

export async function openViewer() {
  wire();
  try {
    const second = await invoke<boolean>('viewer_open');
    useViewer.setState({ open: true });
    last = '';
    send(true);
    if (!second) toast('info', t('viewer.noSecond'), { timeout: 7000 });
  } catch (e) {
    toast('error', String(e));
  }
}

export function closeViewer() {
  invoke('viewer_close').catch(() => {});
  useViewer.setState({ open: false });
}

export const toggleViewer = () => (useViewer.getState().open ? closeViewer() : openViewer());
