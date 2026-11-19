import { useEffect, useMemo, useRef, useState } from 'react';
import { loadingOrder, loadPlan3D, type Bin } from '../lib/loadPlan';
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
  // durée par colis : 0,9 s, plus court quand il y en a beaucoup (25 s au plus)
  const per = Math.max(250, Math.min(900, 25000 / Math.max(1, n)));
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [t, setT] = useState<number | null>(null); // temps écoulé (ms), null = vue complète
  const [playing, setPlaying] = useState(false);
  const last = useRef<number>(0);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = now - last.current;
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
    if (t === null) return { pic: loadPlan3D(bin, lang, 760, logo), idx: n };
    const idx = Math.min(n - 1, Math.floor(t / per));
    const f = (t - idx * per) / per; // 0 → 1
    const p = order[idx];
    const v = bin.vehicle;
    const ease = (x: number) => 1 - (1 - x) ** 3;
    const startX = Math.max(p.x, v.length - p.l);
    const lift0 = Math.max(0, Math.min(25, v.height - p.h - 2));
    const slide = reduced ? 1 : ease(Math.min(1, f / 0.65));
    const drop = reduced ? 1 : f < 0.65 ? 0 : ease((f - 0.65) / 0.35);
    const moving = { ...p, x: startX + (p.x - startX) * slide };
    const sub: Bin = { ...bin, placements: [...order.slice(0, idx), moving] };
    return { pic: loadPlan3D(sub, lang, 760, logo, { no: p.no, dz: lift0 * (1 - drop) }), idx };
  }, [t, bin, order, n, per, lang, logo, reduced]);

  const cur = t === null ? null : order[frame.idx];
  return (
    <div className="load-anim">
      <Drawing pic={frame.pic} className="plan-svg plan-3d" title="Vue 3D du chargement" />
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
