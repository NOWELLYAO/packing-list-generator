import { useEffect, useMemo, useRef, useState } from 'react';
import { loadingOrder, loadPlan3D, type Bin, type View3D } from '../lib/loadPlan';
import type { LogoInfo } from '../lib/drawing';
import { packLabel } from '../lib/i18n';
import Drawing from './Drawing';

/**
 * Vue 3D du chargement, avec animation : les colis entrent un à un par les portes,
 * du fond du véhicule vers l'arrière, dans l'ordre réel de chargement.
 */
export default function LoadAnimation({ bin, lang, logo }: { bin: Bin; lang: 'fr' | 'en'; logo?: LogoInfo }) {
  const order = useMemo(() => loadingOrder(bin), [bin]);
  const n = order.length;
  // durée par colis : 2 s en vitesse normale (plus court quand il y en a beaucoup : 90 s au plus)
  const [speed, setSpeed] = useState<number>(() => {
    try {
      return Number(localStorage.getItem('plgen:animSpeed')) || 1;
    } catch {
      return 1;
    }
  });
  const per = Math.max(600, Math.min(2000, 90000 / Math.max(1, n))) / speed;
  const [t, setT] = useState<number | null>(null); // temps écoulé (ms), null = vue complète
  const [playing, setPlaying] = useState(false);
  const last = useRef<number>(0);
  // point de vue : 4 angles autour du véhicule (glisser le doigt ou boutons ⟲ ⟳) et hauteur de l'œil
  const [angle, setAngle] = useState(0);
  const [elev, setElev] = useState(0.3);
  const ANGLES: { v: View3D; label: string }[] = [
    { v: {}, label: 'côté ouvert, cabine à gauche' },
    { v: { end: true }, label: 'côté ouvert, cabine à droite' },
    { v: { side: true, end: true }, label: 'autre côté, cabine à droite' },
    { v: { side: true }, label: 'autre côté, cabine à gauche' },
  ];
  const view: View3D = { ...ANGLES[angle].v, elev };
  const turn = (d: number) => setAngle((a) => (a + d + 4) % 4);
  const drag = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    last.current = performance.now();
    const tick = (now: number) => {
      // 30 images par seconde suffisent (téléphones : moins de calcul, animation fluide)
      if (now - last.current < 30) {
        raf = requestAnimationFrame(tick);
        return;
      }
      // l'horodatage d'une image peut précéder performance.now() : jamais de temps négatif (ni de saut après une pause de l'onglet)
      const dt = Math.min(200, Math.max(0, now - last.current));
      last.current = now;
      setT((prev) => {
        const next = (prev ?? 0) + dt;
        if (next >= n * per) {
          setPlaying(false);
          return null;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, n, per]);

  // bin réduit aux colis déjà chargés + celui en cours (glissé depuis les portes puis posé)
  const frame = useMemo(() => {
    if (t === null) return { pic: loadPlan3D(bin, lang, 760, logo, undefined, view), idx: n };
    if (!n) return { pic: loadPlan3D(bin, lang, 760, logo, undefined, view), idx: 0 };
    const idx = Math.max(0, Math.min(n - 1, Math.floor(Math.max(0, t) / per)));
    const f = Math.max(0, Math.min(1, (t - idx * per) / per)); // 0 → 1
    const p = order[idx];
    const v = bin.vehicle;
    const ease = (x: number) => 1 - (1 - x) ** 3;
    const startX = Math.max(p.x, v.length - p.l);
    const lift0 = Math.max(0, Math.min(60, v.height - p.h - 2));
    // animation demandée par l'utilisateur (bouton) : jouée même si le téléphone réduit les animations du système
    const slide = ease(Math.min(1, f / 0.65));
    const drop = f < 0.65 ? 0 : ease((f - 0.65) / 0.35);
    const moving = { ...p, x: startX + (p.x - startX) * slide };
    const sub: Bin = { ...bin, placements: [...order.slice(0, idx), moving] };
    return { pic: loadPlan3D(sub, lang, 760, logo, { no: p.no, dz: lift0 * (1 - drop) }, view), idx };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, bin, order, n, per, lang, logo, angle, elev]);

  const cur = t === null ? null : order[frame.idx];
  return (
    <div className="load-anim">
      <div
        className="load-anim-view"
        title="Glissez vers la gauche ou la droite pour tourner autour du véhicule"
        onPointerDown={(e) => {
          drag.current = e.clientX;
        }}
        onPointerMove={(e) => {
          if (drag.current === null) return;
          const dx = e.clientX - drag.current;
          if (Math.abs(dx) > 50) {
            turn(dx > 0 ? -1 : 1);
            drag.current = e.clientX;
          }
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onPointerLeave={() => (drag.current = null)}
      >
        <Drawing pic={frame.pic} className="plan-svg plan-3d" title="Vue 3D du chargement" />
      </div>
      <div className="load-anim-bar">
        <button className="btn small" onClick={() => turn(-1)} aria-label="Tourner à gauche">
          ⟲
        </button>
        <button className="btn small" onClick={() => turn(1)} aria-label="Tourner à droite">
          ⟳
        </button>
        <span className="hint">Vue {angle + 1}/4 : {ANGLES[angle].label}</span>
        <label className="hint load-anim-speed">
          Hauteur{' '}
          <input type="range" min={0.12} max={0.7} step={0.02} value={elev} onChange={(e) => setElev(Number(e.target.value))} aria-label="Hauteur du point de vue" />
        </label>
      </div>
      <div className="load-anim-bar">
        <button
          className="btn small primary"
          onClick={() => {
            if (playing) setPlaying(false);
            else {
              if (t === null) setT(0);
              setPlaying(true);
            }
          }}
        >
          {playing ? '⏸ Pause' : t === null ? '▶ Voir le chargement' : '▶ Reprendre'}
        </button>
        {t !== null && (
          <button
            className="btn small ghost"
            onClick={() => {
              setPlaying(false);
              setT(null);
            }}
          >
            ⏹ Vue finale
          </button>
        )}
        <label className="hint load-anim-speed">
          Vitesse{' '}
          <select
            value={speed}
            onChange={(e) => {
              const v = Number(e.target.value);
              // garde la position dans l'animation quand on change de vitesse
              if (t !== null) setT((t * speed) / v);
              setSpeed(v);
              try {
                localStorage.setItem('plgen:animSpeed', String(v));
              } catch {
                /* stockage indisponible */
              }
            }}
          >
            <option value={0.5}>lente</option>
            <option value={1}>normale</option>
            <option value={2}>rapide</option>
          </select>
        </label>
        <span className="hint" aria-live="polite">
          {cur
            ? `${frame.idx + 1} / ${n} · colis n° ${cur.no} — ${packLabel(cur.type, lang)} ${Math.round(cur.l)} × ${Math.round(cur.w)} × ${Math.round(cur.h)} cm, ${Math.round(cur.kg)} kg`
            : `${n} colis, chargés du fond vers les portes`}
        </span>
      </div>
      {t !== null && (
        <div className="load-anim-progress" aria-hidden>
          <i style={{ width: `${(t / (n * per)) * 100}%` }} />
        </div>
      )}
    </div>
  );
}
