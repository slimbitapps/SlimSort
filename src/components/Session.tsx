import { useStore } from '../store';
import { GridView } from './GridView';
import { SingleView } from './SingleView';
import { CompareView } from './CompareView';
import { Filmstrip } from './Filmstrip';
import { Dock } from './TargetBar';
import { PhotoMenu } from './PhotoMenu';
import { ChatPanel } from './ChatPanel';
import { AiSortDialog } from './AiSort';
import { useAi } from '../ai';
import { useViewer, closeViewer } from '../viewer';
import { t } from '../i18n';
import { IconMonitor } from '../icons';

export function Session() {
  const s = useStore((st) => st.session)!;
  const showFilmstrip = useStore((st) => st.settings.prefs.showFilmstrip);
  const zen = useStore((st) => st.zen);
  const chat = useAi((a) => a.chatOpen) && !zen;
  // Foto läuft auf dem zweiten Bildschirm → hier alle Fotos zur Übersicht und große Ordner-Knöpfe
  const dual = useViewer((v) => v.open);
  return (
    <div className={`session-layout ${chat ? 'with-chat' : ''}`}>
    <div className={`session ${dual ? 'dual' : ''}`} data-testid="session">
      {dual && (
        <div className="dual-banner" data-testid="dual-banner">
          <IconMonitor size={18} />
          <span className="grow">{t('viewer.banner')}</span>
          <button className="btn sm" onClick={closeViewer} data-testid="viewer-close">
            {t('viewer.close')}
          </button>
        </div>
      )}
      <div className="stage-wrap" data-coach="stage" style={{ marginTop: 12 }}>
        {s.compare ? <CompareView s={s} /> : s.view === 'grid' || dual ? <GridView s={s} /> : <SingleView s={s} />}
      </div>
      {s.view === 'single' && showFilmstrip && !s.compare && !dual ? <Filmstrip s={s} /> : <div />}
      <Dock s={s} />
      <PhotoMenu />
    </div>
    {chat && <ChatPanel />}
    <AiSortDialog />
    </div>
  );
}
