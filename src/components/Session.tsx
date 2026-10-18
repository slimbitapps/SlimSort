import { useStore } from '../store';
import { GridView } from './GridView';
import { SingleView } from './SingleView';
import { Filmstrip } from './Filmstrip';
import { Dock } from './TargetBar';

export function Session() {
  const s = useStore((st) => st.session)!;
  const showFilmstrip = useStore((st) => st.settings.prefs.showFilmstrip);
  return (
    <div className="session" data-testid="session">
      <div className="stage-wrap" data-coach="stage" style={{ marginTop: 12 }}>
        {s.view === 'grid' ? <GridView s={s} /> : <SingleView s={s} />}
      </div>
      {s.view === 'single' && showFilmstrip ? <Filmstrip s={s} /> : <div />}
      <Dock s={s} />
    </div>
  );
}
