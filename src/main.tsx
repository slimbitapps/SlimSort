import './bridge';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Viewer } from './components/Viewer';
import './styles.css';

// Das Foto-Fenster (zweiter Bildschirm) zeigt nur das aktuelle Foto/Video
const viewer = (window as unknown as { __SLIMSORT_VIEWER__?: boolean }).__SLIMSORT_VIEWER__;
createRoot(document.getElementById('root')!).render(viewer ? <Viewer /> : <App />);
