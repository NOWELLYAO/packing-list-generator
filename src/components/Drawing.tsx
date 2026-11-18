import type { Picture } from '../lib/drawing';

/** Rendu SVG d'un schéma produit par lib/drawing (identique au PDF) */
export default function Drawing({ pic, className, title }: { pic: Picture; className?: string; title?: string }) {
  return (
    <svg viewBox={`0 0 ${pic.w} ${pic.h}`} className={className} role="img" aria-label={title} preserveAspectRatio="xMidYMid meet">
      {pic.shapes.map((s, i) => {
        switch (s.kind) {
          case 'poly':
            return (
              <polygon
                key={i}
                points={s.pts.map((p) => p.join(',')).join(' ')}
                fill={s.fill}
                fillOpacity={s.opacity}
                stroke={s.stroke ?? 'none'}
                strokeWidth={s.sw ?? 0}
                strokeLinejoin="round"
              />
            );
          case 'line':
            return <line key={i} x1={s.a[0]} y1={s.a[1]} x2={s.b[0]} y2={s.b[1]} stroke={s.stroke} strokeWidth={s.sw} strokeOpacity={s.opacity} strokeLinecap="round" strokeDasharray={s.dash ? '3 2' : undefined} />;
          case 'image':
            return (
              <image
                key={i}
                href={s.href}
                x={0}
                y={0}
                width={1}
                height={1}
                preserveAspectRatio="none"
                transform={`matrix(${s.p1[0] - s.p0[0]} ${s.p1[1] - s.p0[1]} ${s.p3[0] - s.p0[0]} ${s.p3[1] - s.p0[1]} ${s.p0[0]} ${s.p0[1]})`}
              />
            );
          case 'circle':
            return <circle key={i} cx={s.c[0]} cy={s.c[1]} r={s.r} fill={s.fill} stroke={s.stroke} strokeWidth={s.sw} />;
          case 'text':
            return (
              <text
                key={i}
                x={s.at[0]}
                y={s.at[1]}
                fontSize={s.size}
                fill={s.color}
                textAnchor={s.anchor ?? 'start'}
                fontWeight={s.bold ? 700 : 400}
                transform={s.rotate ? `rotate(${s.rotate} ${s.at[0]} ${s.at[1]})` : undefined}
                stroke={s.halo ? '#fff' : undefined}
                strokeWidth={s.halo ? 3 : undefined}
                paintOrder={s.halo ? 'stroke' : undefined}
                dominantBaseline="middle"
                fontFamily="Inter, system-ui, sans-serif"
              >
                {s.text}
              </text>
            );
        }
      })}
    </svg>
  );
}
