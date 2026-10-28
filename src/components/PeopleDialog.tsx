import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { useStore, activeProfile, setOnly, closeDialog, openDialog, setView } from '../store';
import { Dialog, Spinner } from './ui';
import { IconUsers, IconTrash, IconImage, IconFolder } from '../icons';
import { addSample, removePerson, renamePerson, setGroups, mergePeople, peopleEmbs, facesOn, displayName, people as getPeople } from '../people';
import { addMemory, memories, removeMemory } from '../aimemory';
import { refreshRules } from '../ai';
import type { FaceCluster, Person } from '../types';

/** Personen verwalten: Namen, Gruppen, Ordner – und unbekannte Gesichter benennen ("Wer ist das?") */
export function PeopleDialog() {
  const list = useStore((s) => s.settings.people) || [];
  const session = useStore((s) => s.session);
  const facesOn_ = useStore((s) => s.settings.prefs.aiFaces);
  const [clusters, setClusters] = useState<FaceCluster[] | null>(null);
  const [crops, setCrops] = useState<Record<string, string | null>>({});
  const [hidden, setHidden] = useState<Set<number>>(new Set());

  // unbekannte Personen der geöffneten Sortierung (neu, wenn sich die Personen ändern)
  useEffect(() => {
    if (!session || !facesOn_) return setClusters([]);
    const ids = session.items.filter((x) => x.kind === 'image').map((x) => x.id);
    window.api.ai.faceClusters(ids, peopleEmbs(), 2).then(setClusters, () => setClusters([]));
  }, [list.length, list.map((p) => p.embs.length).join(), session?.items, facesOn_]); // eslint-disable-line

  // kleine Gesichtsbilder der Gruppen
  useEffect(() => {
    if (!clusters || !session) return;
    clusters.slice(0, 12).forEach((c, ci) =>
      c.members.slice(0, 3).forEach((m, mi) => {
        const k = `${ci}:${mi}`;
        if (k in crops) return;
        const it = session.byId.get(m.id);
        if (!it) return;
        window.api.ai.faceCrop(it.path, m.box).then((src) => setCrops((c) => ({ ...c, [k]: src })));
      })
    );
  }, [clusters]); // eslint-disable-line

  const visible = (clusters || []).map((c, i) => ({ c, i })).filter((x) => !hidden.has(x.i)).slice(0, 12);

  return (
    <Dialog title={t('people.title')} icon={<IconUsers size={20} />} size="xwide" testId="people-dialog">
      {!facesOn_ && (
        <div className="row" style={{ padding: 12, borderRadius: 12, background: 'var(--accent-soft)', marginBottom: 14 }}>
          <span className="grow">{t('faces.needOn')}</span>
          <button className="btn primary sm" onClick={() => openDialog({ type: 'settings', tab: 'ai' })}>
            {t('faces.enable')}
          </button>
        </div>
      )}
      <p className="muted" style={{ marginTop: 0 }}>
        {t('people.intro')}
      </p>

      {session && facesOn_ && (
        <>
          <div className="section-label">{t('people.unknownTitle')}</div>
          {!clusters ? (
            <Spinner />
          ) : !visible.length ? (
            <p className="muted small">{t('people.noUnknown')}</p>
          ) : (
            <div className="people-grid" style={{ marginBottom: 18 }}>
              {visible.map(({ c, i }) => (
                <ClusterCard
                  key={i}
                  c={c}
                  crops={[0, 1, 2].map((mi) => crops[`${i}:${mi}`])}
                  onName={(name) => {
                    c.samples.forEach((e, si) => addSample(name, e, si === 0 ? crops[`${i}:0`] : null));
                    refreshRules();
                    setHidden(new Set([...hidden, i]));
                  }}
                  onHide={() => setHidden(new Set([...hidden, i]))}
                  onShow={() => {
                    setOnly(c.members.map((m) => m.id), { grid: true });
                    closeDialog();
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}

      <div className="section-label">{t('people.knownTitle', { n: list.length })}</div>
      {!list.length ? (
        <p className="muted small">{t('people.noneYet')}</p>
      ) : (
        <div className="people-grid">
          {list.map((p) => (
            <PersonCard key={p.id} p={p} others={list.filter((x) => x.id !== p.id)} />
          ))}
        </div>
      )}
    </Dialog>
  );
}

function FaceImg({ src, name, lg }: { src?: string | null; name?: string; lg?: boolean }) {
  return src ? <img className={`face-img ${lg ? 'lg' : ''}`} src={src} alt="" /> : <div className={`face-img face-initial ${lg ? 'lg' : ''}`}>{(name || '?').charAt(0).toUpperCase()}</div>;
}

function ClusterCard({ c, crops, onName, onHide, onShow }: { c: FaceCluster; crops: (string | null | undefined)[]; onName: (n: string) => void; onHide: () => void; onShow: () => void }) {
  const [name, setName] = useState('');
  const list = getPeople();
  return (
    <div className="person-card" data-testid="cluster-card">
      <div className="grow">
        <div className="cluster-faces">
          {crops.map((src, i) => (src !== undefined || i < c.members.length ? <FaceImg key={i} src={src} /> : null))}
        </div>
        <div className="meta">{t('people.onPhotos', { n: c.members.length })}</div>
        <form
          className="row"
          style={{ gap: 6 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onName(name);
          }}
        >
          <input className="input" value={name} placeholder={t('face.whoIsThis')} onChange={(e) => setName(e.target.value)} list="people-names" data-testid="cluster-name" />
          <datalist id="people-names">
            {list.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
          <button className="btn primary sm" type="submit" disabled={!name.trim()}>
            {t('common.ok')}
          </button>
        </form>
        <div className="acts" style={{ marginTop: 6 }}>
          {!list.some((p) => p.me) && (
            <button className="btn ghost sm" onClick={() => onName('ich')}>
              {t('face.thatsMe')}
            </button>
          )}
          <button className="btn ghost sm" onClick={onShow}>
            <IconImage size={14} />
            {t('people.showPhotos')}
          </button>
          <button className="btn ghost sm" onClick={onHide}>
            {t('people.skip')}
          </button>
        </div>
      </div>
    </div>
  );
}

function PersonCard({ p, others }: { p: Person; others: Person[] }) {
  const session = useStore((s) => s.session);
  const targets = activeProfile().targets;
  const rule = memories().find((m) => m.kind === 'people' && m.personIds?.length === 1 && m.personIds[0] === p.id);
  const [name, setName] = useState(p.me ? displayName(p) : p.name);
  const [groups, setGroupsText] = useState((p.groups || []).join(', '));
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!session) return;
    const ids = session.items.filter((x) => x.kind === 'image').map((x) => x.id);
    facesOn(ids).then((m) => setCount([...m.values()].filter((f) => f.some((x) => x.person?.id === p.id)).length));
  }, [session?.items, p.embs.length]); // eslint-disable-line

  const showPhotos = async () => {
    if (!session) return;
    const ids = session.items.filter((x) => x.kind === 'image').map((x) => x.id);
    const m = await facesOn(ids);
    setOnly(ids.filter((id) => m.get(id)?.some((f) => f.person?.id === p.id)), { grid: true });
    setView('grid');
    closeDialog();
  };

  return (
    <div className="person-card" data-testid="person-card" data-name={p.name}>
      <FaceImg src={p.crop} name={p.name} lg />
      <div className="grow">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== (p.me ? displayName(p) : p.name) && renamePerson(p.id, name)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label={t('people.name')}
        />
        <div className="meta">
          {t('people.samples', { n: p.embs.length })}
          {count !== null && ` · ${t('people.onPhotos', { n: count })}`}
        </div>
        <input
          className="input"
          style={{ marginBottom: 6 }}
          value={groups}
          placeholder={t('people.groupsPlaceholder')}
          onChange={(e) => setGroupsText(e.target.value)}
          onBlur={() => setGroups(p.id, groups.split(',').map((x) => x.trim()).filter(Boolean))}
          aria-label={t('people.groups')}
        />
        <div className="row" style={{ gap: 6, marginBottom: 6 }}>
          <IconFolder size={14} style={{ flex: 'none', opacity: 0.7 }} />
          <select
            className="input"
            value={rule?.targetPath || ''}
            onChange={(e) => {
              if (rule) removeMemory(rule.id);
              if (e.target.value) addMemory({ kind: 'people', text: `${p.name} → ${targets.find((x) => x.path === e.target.value)?.name}`, label: displayName(p), personIds: [p.id], targetPath: e.target.value });
              refreshRules();
            }}
            aria-label={t('people.folder')}
          >
            <option value="">{t('people.noFolder')}</option>
            {targets.map((x) => (
              <option key={x.id} value={x.path}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
        <div className="acts">
          {session && (
            <button className="btn ghost sm" onClick={showPhotos}>
              <IconImage size={14} />
              {t('people.showPhotos')}
            </button>
          )}
          {others.length > 0 && (
            <select
              className="input sm"
              value=""
              onChange={(e) => e.target.value && mergePeople(e.target.value, p.id)}
              aria-label={t('people.merge')}
            >
              <option value="">{t('people.merge')}</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {t('people.mergeWith', { name: displayName(o) })}
                </option>
              ))}
            </select>
          )}
          <button
            className="btn ghost sm danger"
            onClick={async () => {
              const r = await window.api.confirm({ message: t('people.removeAsk', { name: displayName(p) }), buttons: [t('people.remove'), t('common.cancel')], type: 'warning' });
              if (r !== 0) return;
              removePerson(p.id);
              refreshRules();
            }}
          >
            <IconTrash size={14} />
            {t('people.remove')}
          </button>
        </div>
      </div>
    </div>
  );
}
