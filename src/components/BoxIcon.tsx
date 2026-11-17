/** Petite boîte isométrique proportionnelle aux dimensions du colis */
export default function BoxIcon({ l, w, h, size = 46 }: { l: number; w: number; h: number; size?: number }) {
  if (!l || !w || !h) {
    return (
      <svg width={size} height={size} viewBox="0 0 46 46" aria-hidden>
        <rect x="9" y="12" width="28" height="24" rx="3" className="box-side" />
      </svg>
    );
  }
  const c = Math.cos(Math.PI / 6);
  const proj = (a: number, b: number, z: number): [number, number] => [(a - b) * c, (a + b) * 0.5 - z];
  // 8 sommets, puis mise à l'échelle et centrage dans un carré de 46 px (marge 4 px)
  const corners = [0, l].flatMap((a) => [0, w].flatMap((b) => [0, h].map((z) => proj(a, b, z))));
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const k = 38 / Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY);
  const offX = (46 - (Math.max(...xs) - minX) * k) / 2;
  const offY = (46 - (Math.max(...ys) - minY) * k) / 2;
  const pt = (a: number, b: number, z: number) => {
    const [x, y] = proj(a, b, z);
    return `${((x - minX) * k + offX).toFixed(1)},${((y - minY) * k + offY).toFixed(1)}`;
  };
  return (
    <svg width={size} height={size} viewBox="0 0 46 46" aria-hidden>
      <polygon className="box-top" points={[pt(0, 0, h), pt(l, 0, h), pt(l, w, h), pt(0, w, h)].join(' ')} />
      <polygon className="box-left" points={[pt(0, w, 0), pt(l, w, 0), pt(l, w, h), pt(0, w, h)].join(' ')} />
      <polygon className="box-right" points={[pt(l, 0, 0), pt(l, w, 0), pt(l, w, h), pt(l, 0, h)].join(' ')} />
    </svg>
  );
}
