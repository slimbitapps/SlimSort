import { useEffect, useState } from 'react';
import { t } from '../i18n';

/** Fensterknöpfe für Windows (die Kopfleiste reicht bis ganz oben). */
export function WindowControls() {
  const [max, setMax] = useState(false);
  useEffect(() => {
    const upd = () => window.api.win.isMaximized().then(setMax);
    upd();
    return window.api.win.onResized(upd);
  }, []);
  return (
    <div className="win-controls" data-testid="win-controls">
      <button aria-label={t('win.minimize')} title={t('win.minimize')} onClick={() => window.api.win.minimize()}>
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      <button aria-label={max ? t('win.restore') : t('win.maximize')} title={max ? t('win.restore') : t('win.maximize')} onClick={() => window.api.win.toggleMaximize()}>
        {max ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><path d="M2.5 2.5V.5h7v7h-2" /><rect x=".5" y="2.5" width="7" height="7" /></svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><rect x=".5" y=".5" width="9" height="9" /></svg>
        )}
      </button>
      <button className="close" aria-label={t('common.close')} title={t('common.close')} onClick={() => window.api.win.close()}>
        <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.1"><path d="M0 0l10 10M10 0L0 10" /></svg>
      </button>
    </div>
  );
}
