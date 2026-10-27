import { t } from '../i18n';
import { useStore, activeProfile } from '../store';
import { useAi, planGroups, runPlan } from '../ai';
import { thumbUrl, fmtNum } from '../util';
import { Dialog } from './ui';
import { IconSparkle, IconTrash } from '../icons';

/** "KI sortieren": zeigt, welche Fotos die KI wohin tun würde – du bestätigst. */
export function AiSortDialog() {
  const plan = useAi((a) => a.plan);
  const s = useStore((st) => st.session);
  if (!plan || !s) return null;
  const close = () => useAi.setState({ plan: null });
  const groups = planGroups(plan);
  const targets = activeProfile().targets;
  const total = groups.filter((g) => g.on).reduce((n, g) => n + g.ids.length, 0);
  const open = s.viewIds.length;
  const set = (patch: Partial<typeof plan>) => useAi.setState({ plan: { ...plan, ...patch } });
  return (
    <Dialog
      title={t('ai.sortTitle')}
      icon={<IconSparkle size={18} />}
      size="wide"
      onClose={close}
      testId="ai-sort"
      footer={
        <>
          <span className="muted small" style={{ marginRight: 'auto' }}>
            {t('ai.sortRest', { n: fmtNum(Math.max(0, open - total)) })}
          </span>
          <button className="btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!total} onClick={() => runPlan(plan)} data-testid="ai-sort-run">
            {t('ai.sortRun', { n: fmtNum(total) })}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {t('ai.sortIntro')}
      </p>
      <div className="ai-conf">
        <label htmlFor="ai-conf">{t('ai.sortConf')}</label>
        <input
          id="ai-conf"
          type="range"
          min={50}
          max={99}
          value={Math.round(plan.minConf * 100)}
          onChange={(e) => set({ minConf: Number(e.target.value) / 100 })}
          data-testid="ai-sort-conf"
        />
        <b>{Math.round(plan.minConf * 100)} %</b>
      </div>
      {!groups.length && <p className="muted">{t('ai.sortNone')}</p>}
      <div className="ai-groups">
        {groups.map((g) => {
          const tg = targets.find((x) => x.id === g.targetId);
          const trash = g.targetId === 'trash';
          const name = trash ? t('targets.trash') : tg?.name ?? '?';
          return (
            <label key={g.targetId} className={`ai-group ${g.on ? '' : 'off'}`} data-testid="ai-group">
              <input
                type="checkbox"
                checked={g.on}
                onChange={() => {
                  const off = new Set(plan.off);
                  if (off.has(g.targetId)) off.delete(g.targetId);
                  else off.add(g.targetId);
                  set({ off });
                }}
              />
              <span className="ai-dot" style={{ background: trash ? 'var(--danger)' : tg?.color }}>
                {trash && <IconTrash size={12} />}
              </span>
              <span className="ai-name">
                <b>{name}</b>
                <span className="muted small">{t('ai.sortCount', { n: fmtNum(g.ids.length) })}</span>
              </span>
              <span className="ai-thumbs">
                {g.ids.slice(0, 6).map((id) => {
                  const it = s.byId.get(id);
                  return it ? <img key={id} src={thumbUrl(it.path, 256)} alt="" loading="lazy" draggable={false} /> : null;
                })}
              </span>
            </label>
          );
        })}
      </div>
    </Dialog>
  );
}
