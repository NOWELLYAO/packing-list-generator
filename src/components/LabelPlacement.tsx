/**
 * Où coller l'étiquette : trois petits schémas (carton, palette filmée, caisse) avec l'emplacement
 * des étiquettes sur les faces latérales, et les règles d'usage en logistique.
 */

const C30 = Math.cos(Math.PI / 6);
type P = [number, number];
/** projection isométrique : a = longueur (vers la droite), b = profondeur (vers la gauche), z = hauteur */
const iso = (a: number, b: number, z: number, ox: number, oy: number): P => [ox + (a - b) * C30, oy + (a + b) * 0.5 - z];
const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const pts = (ps: P[]) => ps.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');

function Box({ L, l, H, z0 = 0, fill, stroke, ox, oy }: { L: number; l: number; H: number; z0?: number; fill: [string, string, string]; stroke: string; ox: number; oy: number }) {
  const I = (a: number, b: number, z: number) => iso(a, b, z, ox, oy);
  return (
    <g stroke={stroke} strokeWidth={0.8} strokeLinejoin="round">
      <polygon points={pts([I(0, l, z0), I(L, l, z0), I(L, l, z0 + H), I(0, l, z0 + H)])} fill={fill[0]} />
      <polygon points={pts([I(L, 0, z0), I(L, l, z0), I(L, l, z0 + H), I(L, 0, z0 + H)])} fill={fill[1]} />
      <polygon points={pts([I(0, 0, z0 + H), I(L, 0, z0 + H), I(L, l, z0 + H), I(0, l, z0 + H)])} fill={fill[2]} />
    </g>
  );
}

/** étiquette sur la face avant (b = l) ou latérale (a = L) */
function Label({ face, L, l, a, z, w, h, ox, oy }: { face: 'front' | 'side'; L: number; l: number; a: number; z: number; w: number; h: number; ox: number; oy: number }) {
  const I = (x: number, y: number, zz: number) => iso(x, y, zz, ox, oy);
  const q: P[] =
    face === 'front' ? [I(a, l, z), I(a + w, l, z), I(a + w, l, z + h), I(a, l, z + h)] : [I(L, a, z), I(L, a + w, z), I(L, a + w, z + h), I(L, a, z + h)];
  return (
    <g>
      <polygon points={pts(q)} fill="#ffffff" stroke="#c2410c" strokeWidth={1.4} />
      {/* bandeau en haut de l'étiquette (logo + n° de colis) */}
      <polygon points={pts([q[3], q[2], lerp(q[2], q[1], 0.32), lerp(q[3], q[0], 0.32)])} fill="var(--accent)" opacity={0.9} />
    </g>
  );
}

export default function LabelPlacement() {
  const kraft: [string, string, string] = ['#d6b98e', '#bf9f72', '#e6cfa8'];
  const wood: [string, string, string] = ['#d9b483', '#c29b68', '#e8cc9f'];
  const film: [string, string, string] = ['#d9c6a6', '#c3ae8b', '#e9dcc4'];
  return (
    <div className="label-help">
      <div className="label-help-figs">
        <figure>
          <svg viewBox="0 0 150 120" role="img" aria-label="Carton : une étiquette sur la plus grande face latérale">
            <Box L={70} l={45} H={45} fill={kraft} stroke="#8a6a40" ox={70} oy={40} />
            <Label face="front" L={70} l={45} a={14} z={10} w={36} h={24} ox={70} oy={40} />
          </svg>
          <figcaption>
            <b>Carton</b> · 1 étiquette
          </figcaption>
        </figure>
        <figure>
          <svg viewBox="0 0 150 120" role="img" aria-label="Palette : deux étiquettes sur deux faces adjacentes, dans le tiers supérieur">
            <Box L={78} l={52} H={10} fill={wood} stroke="#8a6a40" ox={68} oy={44} />
            <Box L={78} l={52} H={52} z0={10} fill={film} stroke="#8a6a40" ox={68} oy={44} />
            <Label face="front" L={78} l={52} a={18} z={36} w={30} h={20} ox={68} oy={44} />
            <Label face="side" L={78} l={52} a={12} z={36} w={26} h={20} ox={68} oy={44} />
          </svg>
          <figcaption>
            <b>Palette</b> · 2 étiquettes
          </figcaption>
        </figure>
        <figure>
          <svg viewBox="0 0 150 120" role="img" aria-label="Caisse : deux étiquettes sur deux faces, sur une planche plane">
            <Box L={86} l={40} H={46} fill={wood} stroke="#7a5a32" ox={64} oy={42} />
            <Label face="front" L={86} l={40} a={22} z={14} w={32} h={22} ox={64} oy={42} />
            <Label face="side" L={86} l={40} a={8} z={14} w={24} h={22} ox={64} oy={42} />
          </svg>
          <figcaption>
            <b>Caisse</b> · 2 étiquettes
          </figcaption>
        </figure>
      </div>
      <ul className="label-help-rules">
        <li>
          Sur une <b>face latérale</b>, bien droite (flèches « Haut » vers le haut), <b>jamais sur le dessus</b> : un colis posé dessus la cacherait.
        </li>
        <li>
          <b>Palette filmée</b> : 2 étiquettes sur <b>deux faces adjacentes</b> (un grand et un petit côté), dans le tiers supérieur, collées sur un carton
          ou glissées dans une pochette <b>sous le film</b> — pas sur le bois de la palette.
        </li>
        <li>
          <b>Caisse</b> : 2 étiquettes sur une planche plane (pas sur les montants), agrafées ou en pochette si le bois est brut.
        </li>
        <li>
          <b>Carton</b> : la plus grande face, à plat, loin des arêtes et du ruban adhésif. Recouvrez les anciennes étiquettes.
        </li>
      </ul>
    </div>
  );
}
