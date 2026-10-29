import { t, type TKey } from '../i18n';
import { useStore, closeDialog, openDialog, updateSettings } from '../store';
import { Dialog } from './ui';
import { toggleChat } from '../ai';
import { openViewer } from '../viewer';
import { IconSparkle, IconChat, IconUsers, IconActivity, IconFolder, IconMonitor, IconEyeOff, IconVideo, IconStar } from '../icons';
import { modKey } from '../util';

/** Kennung der aktuellen Tipps – neu setzen, wenn neue Funktionen dazukommen (dann erscheinen sie einmal) */
export const NEWS_ID = '2.0-ki';

type Card = { icon: typeof IconSparkle; title: TKey; text: TKey; vars?: Record<string, string>; go?: () => void; ai?: boolean; session?: boolean };

const CARDS: Card[] = [
  { icon: IconSparkle, title: 'news.ai.title', text: 'news.ai.text', go: () => openDialog({ type: 'settings', tab: 'ai' }) },
  { icon: IconChat, title: 'news.chat.title', text: 'news.chat.text', ai: true, session: true, go: () => (closeDialog(), toggleChat(true)) },
  { icon: IconUsers, title: 'news.people.title', text: 'news.people.text', ai: true, go: () => openDialog({ type: 'people' }) },
  { icon: IconActivity, title: 'news.log.title', text: 'news.log.text', ai: true, go: () => openDialog({ type: 'ailog' }) },
  { icon: IconFolder, title: 'news.lib.title', text: 'news.lib.text', ai: true, go: () => openDialog({ type: 'settings', tab: 'ai' }) },
  { icon: IconMonitor, title: 'news.viewer.title', text: 'news.viewer.text', session: true, go: () => (closeDialog(), openViewer()) },
  { icon: IconEyeOff, title: 'news.marks.title', text: 'news.marks.text' },
  { icon: IconVideo, title: 'news.video.title', text: 'news.video.text', go: () => openDialog({ type: 'settings', tab: 'sorting' }) },
];

export function markNewsSeen() {
  if (useStore.getState().settings.newsSeen !== NEWS_ID) updateSettings((s) => ({ ...s, newsSeen: NEWS_ID }));
}

/** „Tipps & Neues“: was die App kann, kurz erklärt, mit Knopf zum Ausprobieren */
export function NewsDialog() {
  const aiOn = useStore((s) => s.settings.prefs.aiEnabled);
  const inSession = useStore((s) => !!s.session);
  const close = () => {
    markNewsSeen();
    closeDialog();
  };
  return (
    <Dialog
      title={t('news.title')}
      icon={<IconStar size={20} />}
      size="wide"
      testId="news-dialog"
      onClose={close}
      footer={
        <button className="btn primary" onClick={close} data-testid="news-ok">
          {t('news.ok')}
        </button>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {t('news.intro')}
      </p>
      <div className="news-grid">
        {CARDS.map((c) => {
          const Icon = c.icon;
          const can = c.go && (!c.ai || aiOn) && (!c.session || inSession);
          return (
            <div key={c.title} className="news-card" data-testid="news-card">
              <div className="news-icon">
                <Icon size={20} />
              </div>
              <div className="grow">
                <div className="news-title">{t(c.title)}</div>
                <div className="news-text">{t(c.text, { mod: modKey() })}</div>
                {can && (
                  <button
                    className="btn sm"
                    onClick={() => {
                      markNewsSeen();
                      c.go!();
                    }}
                  >
                    {t('news.try')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
