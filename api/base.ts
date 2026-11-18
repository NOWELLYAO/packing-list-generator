/**
 * Sauvegarde en ligne de la base (fonction serveur Vercel).
 *
 * Stockage : Upstash Redis (Vercel → Storage / Marketplace → « Upstash for Redis »), qui fournit
 * KV_REST_API_URL / KV_REST_API_TOKEN (ou UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).
 *
 * Chaque « espace » est identifié par un code secret (ex. PL-7KQ2-M9XD-4TRP-HB3C) choisi côté appareil ;
 * seule son empreinte SHA-256 sert de clé : sans le code, impossible de lire ou d'écrire la base.
 *
 *   GET  /api/base                 → document de l'espace (404 s'il n'existe pas encore)
 *   GET  /api/base?versions=1      → résumé des 10 versions précédentes
 *   GET  /api/base?version=N       → version précédente N
 *   PUT  /api/base  {doc, base, force?}
 *        → 409 si quelqu'un a écrit depuis `base` (le client fusionne et renvoie)
 *        → 409 « empty » si on tente d'écraser une base remplie par une base vide
 */
import { createHash } from 'node:crypto';

export interface CloudDoc {
  updatedAt: number;
  catalog: unknown[];
  history?: unknown[];
  accuracy?: unknown[];
  settings?: unknown;
  device?: string;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const VERSIONS = 10;
const CODE_RE = /^[A-Z0-9-]{12,64}$/;

export function storeConfig(env: Record<string, string | undefined>) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

export const keyFor = (code: string) => 'plgen:space:' + createHash('sha256').update(code).digest('hex');

async function redis(cfg: { url: string; token: string }, fetcher: Fetch, cmds: (string | number)[][]): Promise<unknown[]> {
  const r = await fetcher(`${cfg.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error(`stockage indisponible (${r.status})`);
  const out = (await r.json()) as { result?: unknown; error?: string }[];
  const err = out.find((x) => x.error);
  if (err) throw new Error(err.error);
  return out.map((x) => x.result);
}

const summary = (d: CloudDoc) => ({ updatedAt: d.updatedAt, articles: Array.isArray(d.catalog) ? d.catalog.length : 0, device: d.device ?? '' });

export interface Req {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
}
export interface Result {
  status: number;
  body: unknown;
}

/** Logique du service, indépendante de Vercel (testable) */
export async function handle(req: Req, env: Record<string, string | undefined>, fetcher: Fetch): Promise<Result> {
  const cfg = storeConfig(env);
  if (!cfg) return { status: 503, body: { error: 'not_configured' } };
  const raw = req.headers['x-plgen-space'];
  const code = (Array.isArray(raw) ? raw[0] : raw ?? '').trim().toUpperCase();
  if (!CODE_RE.test(code)) return { status: 400, body: { error: 'bad_code' } };
  const key = keyFor(code);
  const q = req.query ?? {};
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  try {
    if (req.method === 'GET') {
      if (one(q.versions)) {
        const [list] = await redis(cfg, fetcher, [['LRANGE', `${key}:versions`, 0, VERSIONS - 1]]);
        return { status: 200, body: { versions: ((list as string[]) ?? []).map((s, i) => ({ index: i, ...summary(JSON.parse(s) as CloudDoc) })) } };
      }
      const v = one(q.version);
      if (v !== undefined) {
        const [s] = await redis(cfg, fetcher, [['LINDEX', `${key}:versions`, Number(v) || 0]]);
        return s ? { status: 200, body: { doc: JSON.parse(s as string) } } : { status: 404, body: { error: 'not_found' } };
      }
      const [s] = await redis(cfg, fetcher, [['GET', key]]);
      return s ? { status: 200, body: { doc: JSON.parse(s as string) } } : { status: 404, body: { error: 'not_found' } };
    }

    if (req.method === 'PUT') {
      const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as { doc?: CloudDoc; base?: number; force?: boolean };
      const doc = body?.doc;
      if (!doc || !Array.isArray(doc.catalog) || typeof doc.updatedAt !== 'number') return { status: 400, body: { error: 'bad_doc' } };
      const [curRaw] = await redis(cfg, fetcher, [['GET', key]]);
      const cur = curRaw ? (JSON.parse(curRaw as string) as CloudDoc) : null;
      if (cur && !body.force) {
        // quelqu'un (autre appareil, collègue) a enregistré depuis la dernière synchronisation de cet appareil
        if (cur.updatedAt > (body.base ?? 0)) return { status: 409, body: { error: 'conflict', doc: cur } };
        // garde-fou : une base vide n'écrase jamais une base remplie (navigateur vidé, mauvaise manipulation)
        if (cur.catalog.length > 0 && doc.catalog.length === 0) return { status: 409, body: { error: 'empty', doc: cur } };
      }
      const cmds: (string | number)[][] = [['SET', key, JSON.stringify(doc)]];
      if (cur) cmds.push(['LPUSH', `${key}:versions`, curRaw as string], ['LTRIM', `${key}:versions`, 0, VERSIONS - 1]);
      await redis(cfg, fetcher, cmds);
      return { status: 200, body: { updatedAt: doc.updatedAt } };
    }
    return { status: 405, body: { error: 'method' } };
  } catch (e) {
    return { status: 502, body: { error: 'store', detail: String((e as Error).message ?? e) } };
  }
}

/** Point d'entrée Vercel (Node) */
export default async function handler(
  req: Req,
  res: { status: (n: number) => { json: (b: unknown) => void }; setHeader: (k: string, v: string) => void },
) {
  res.setHeader('Cache-Control', 'no-store');
  const r = await handle(req, process.env, fetch as unknown as Fetch);
  res.status(r.status).json(r.body);
}
