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
 *
 * Contrôle d'accès (facultatif, par espace) : POST /api/base {action, …}
 *   status            → protection activée ? liste des noms (écran de connexion)
 *   setup {name,pin}  → crée le premier administrateur (seulement si aucun accès n'existe)
 *   login {userId,pin}→ jeton signé (12 h) ; 8 essais ratés → blocage 15 min
 *   users / saveUser / deleteUser / disable → réservés à l'administrateur (jeton)
 * Quand la protection est active, GET/PUT exigent le jeton (en-tête x-plgen-token) et le serveur
 * ignore toute modification de la base d'articles ou des réglages venant d'un compte qui n'en a pas le droit.
 */
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export interface CloudDoc {
  updatedAt: number;
  catalog: unknown[];
  history?: unknown[];
  accuracy?: unknown[];
  settings?: unknown;
  pending?: { id: string; by?: { id?: string } }[];
  pendingDone?: string[];
  device?: string;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const VERSIONS = 10;
/** espace unique autorisé quand l'application est réservée à une entreprise */
const ORG_KEY = 'plgen:org';
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-Z0-9-]{12,64}$/;
const SHARE_LEN = 20;
const SHARE_RE = /^[A-Z0-9]{20}$/;
/** taille maximale d'un instantané partagé (PL + logo) */
const SHARE_MAX = 600_000;

export function storeConfig(env: Record<string, string | undefined>) {
  let url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  let token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  // préfixe personnalisé choisi à la connexion du stockage (ex. STORAGE_REST_API_URL / STORAGE_REST_API_TOKEN)
  if (!url || !token) {
    for (const k of Object.keys(env)) {
      if (!k.endsWith('_REST_API_URL')) continue;
      const prefix = k.slice(0, -'_REST_API_URL'.length);
      const t = env[`${prefix}_REST_API_TOKEN`];
      if (env[k] && t) {
        url = env[k];
        token = t;
        break;
      }
    }
  }
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


/* ------------------------------------------------------------------ */
/* Contrôle d'accès                                                    */
/* ------------------------------------------------------------------ */

export const PERMS = [
  'generate', 'orderImport', 'freight', 'freightRates',
  'export', 'labels', 'exportDocs', 'shareLink',
  'history', 'dashboard',
  'catalogView', 'catalogExport', 'catalogBackup', 'catalogEdit', 'catalogLoad', 'catalogRestore', 'catalogClear', 'import',
  'settings', 'users',
] as const;
export type Perm = (typeof PERMS)[number];
export interface AuthUser {
  id: string;
  name: string;
  role: 'admin' | 'user' | 'viewer';
  perms: Perm[];
  salt: string;
  hash: string;
  disabled?: boolean;
  /** 2 : droits détaillés choisis par l'administrateur (sinon compte créé avant leur arrivée) */
  pv?: number;
}
interface AuthRec {
  users: AuthUser[];
}
interface Session {
  u: string;
  n: string;
  r: AuthUser['role'];
  p: Perm[];
  exp: number;
}

const SESSION_MS = 12 * 3600 * 1000;
const PIN_RE = /^\d{4,8}$/;
const b64 = (s: string) => Buffer.from(s).toString('base64url');
const secretOf = (env: Record<string, string | undefined>, cfg: { token: string }) =>
  env.AUTH_SECRET || createHash('sha256').update('plgen-auth:' + cfg.token).digest('hex');
const hashPin = (pin: string, salt: string) => scryptSync(pin, salt, 32).toString('hex');

export function signSession(s: Session, secret: string): string {
  const payload = b64(JSON.stringify(s));
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
export function readSession(token: string | undefined, secret: string, now = Date.now()): Session | null {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const good = createHmac('sha256', secret).update(payload).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== good.length || !timingSafeEqual(given, good)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    return s.exp > now ? s : null;
  } catch {
    return null;
  }
}

/** droits ajoutés après la création des premiers comptes : déduits des droits d'origine tant que l'administrateur n'a pas revu le compte */
const LEGACY_GRANTS: Record<string, Perm[]> = {
  generate: ['orderImport', 'freight'],
  export: ['labels', 'exportDocs', 'shareLink', 'catalogExport', 'catalogBackup'],
  catalogEdit: ['catalogLoad', 'catalogRestore', 'catalogClear'],
  history: ['dashboard'],
  settings: ['freightRates'],
};
export function effectivePerms(u: { role: string; perms: Perm[]; pv?: number }): Perm[] {
  if (u.role === 'admin') return [...PERMS];
  if (u.pv === 2) return u.perms;
  return [...new Set([...u.perms, ...u.perms.flatMap((p) => LEGACY_GRANTS[p] ?? [])])];
}
const publicUser = (u: AuthUser) => ({ id: u.id, name: u.name, role: u.role, perms: effectivePerms(u), pv: 2, disabled: !!u.disabled });
const ADMIN_PERMS: Perm[] = [...PERMS];
const cleanPerms = (p: unknown): Perm[] => (Array.isArray(p) ? p.filter((x): x is Perm => (PERMS as readonly string[]).includes(String(x))) : []);
/** empreinte d'une base d'articles : (code, PN, date de modification) — indépendante de l'ordre */
const catalogPrint = (c: unknown[]) =>
  c
    .map((x) => {
      const i = x as { code?: string; pn?: string; updatedAt?: string; manual?: boolean };
      return `${i.code}|${i.pn}|${i.updatedAt}|${i.manual ? 1 : 0}`;
    })
    .sort()
    .join('\n');

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
  // actions sans espace : application réservée à une entreprise ? invitation courte → code d'espace
  if (req.method === 'POST') {
    const b0 = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as Record<string, unknown>;
    try {
      if (b0.action === 'orgStatus') {
        const [org] = await redis(cfg, fetcher, [['GET', ORG_KEY]]);
        return { status: 200, body: { locked: !!org } };
      }
      // lien de suivi client : lecture publique d'un instantané de PL (identifiant aléatoire de 20 caractères)
      if (b0.action === 'shared') {
        const id = String(b0.id ?? '');
        if (!SHARE_RE.test(id)) return { status: 400, body: { error: 'bad_share' } };
        const [snap] = await redis(cfg, fetcher, [['GET', `plgen:share:${id}`]]);
        return snap ? { status: 200, body: { snapshot: JSON.parse(snap as string) } } : { status: 404, body: { error: 'share_expired' } };
      }
      if (b0.action === 'redeem') {
        const inv = String(b0.invite ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!/^[A-Z0-9]{6}$/.test(inv)) return { status: 400, body: { error: 'bad_invite' } };
        const [space] = await redis(cfg, fetcher, [['GET', `plgen:invite:${inv}`]]);
        return space ? { status: 200, body: { space } } : { status: 404, body: { error: 'invite_expired' } };
      }
    } catch (e) {
      return { status: 502, body: { error: 'store', detail: String((e as Error).message ?? e) } };
    }
  }
  const raw = req.headers['x-plgen-space'];
  const code = (Array.isArray(raw) ? raw[0] : raw ?? '').trim().toUpperCase();
  if (!CODE_RE.test(code)) return { status: 400, body: { error: 'bad_code' } };
  const key = keyFor(code);
  const q = req.query ?? {};
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const secret = secretOf(env, cfg);

  try {
    const [authRaw, orgKey] = await redis(cfg, fetcher, [['GET', `${key}:auth`], ['GET', ORG_KEY]]);
    // application réservée à l'espace de l'entreprise : aucun autre espace ne peut être créé ni utilisé
    if (orgKey && orgKey !== key) return { status: 403, body: { error: 'org_locked' } };
    const auth = authRaw ? (JSON.parse(authRaw as string) as AuthRec) : null;
    const tokRaw = req.headers['x-plgen-token'];
    const session = readSession(Array.isArray(tokRaw) ? tokRaw[0] : tokRaw, secret);
    const live = session && auth?.users.find((u) => u.id === session.u && !u.disabled);
    const me: Session | null = live ? { ...session!, r: live.role, p: effectivePerms(live), n: live.name } : null;

    if (req.method === 'POST') {
      const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as Record<string, unknown>;
      const action = String(body.action ?? '');
      const saveAuth = (a: AuthRec) => redis(cfg, fetcher, [['SET', `${key}:auth`, JSON.stringify(a)]]);
      const issue = (u: AuthUser) => ({ token: signSession({ u: u.id, n: u.name, r: u.role, p: u.perms, exp: Date.now() + SESSION_MS }, secret), user: publicUser(u) });
      if (action === 'status') return { status: 200, body: { enabled: !!auth, users: (auth?.users ?? []).filter((u) => !u.disabled).map((u) => ({ id: u.id, name: u.name })) } };
      if (action === 'share') {
        // protection active : il faut être connecté avec le droit d'exporter
        if (auth && !(me && me.p.includes('shareLink'))) return { status: me ? 403 : 401, body: { error: me ? 'forbidden' : 'login' } };
        const snap = JSON.stringify(body.snapshot ?? null);
        if (snap === 'null' || snap.length > SHARE_MAX) return { status: 413, body: { error: 'too_large' } };
        const id = Array.from(randomBytes(SHARE_LEN), (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join('');
        const days = Math.min(365, Math.max(1, Number(body.days) || 90));
        await redis(cfg, fetcher, [['SET', `plgen:share:${id}`, snap, 'EX', days * 86400]]);
        return { status: 200, body: { id, expiresIn: days * 86400 } };
      }
      if (action === 'setup') {
        if (auth) return { status: 409, body: { error: 'exists' } };
        const name = String(body.name ?? '').trim().slice(0, 40);
        const pin = String(body.pin ?? '');
        if (!name || !PIN_RE.test(pin)) return { status: 400, body: { error: 'bad_input' } };
        const salt = randomBytes(16).toString('hex');
        const admin: AuthUser = { id: randomBytes(6).toString('hex'), name, role: 'admin', perms: ADMIN_PERMS, salt, hash: hashPin(pin, salt) };
        await saveAuth({ users: [admin] });
        return { status: 200, body: issue(admin) };
      }
      if (action === 'login') {
        if (!auth) return { status: 404, body: { error: 'no_auth' } };
        const u = auth.users.find((x) => x.id === body.userId && !x.disabled);
        if (!u) return { status: 401, body: { error: 'bad_pin' } };
        const failKey = `${key}:fail:${u.id}`;
        const [fails] = await redis(cfg, fetcher, [['GET', failKey]]);
        if (Number(fails) >= 8) return { status: 429, body: { error: 'locked' } };
        const pin = String(body.pin ?? '');
        const ok = PIN_RE.test(pin) && timingSafeEqual(Buffer.from(hashPin(pin, u.salt), 'hex'), Buffer.from(u.hash, 'hex'));
        if (!ok) {
          await redis(cfg, fetcher, [['INCR', failKey], ['EXPIRE', failKey, 900]]);
          return { status: 401, body: { error: 'bad_pin', left: Math.max(0, 7 - Number(fails ?? 0)) } };
        }
        await redis(cfg, fetcher, [['DEL', failKey]]);
        return { status: 200, body: issue(u) };
      }
      // actions d'administration
      if (!auth) return { status: 404, body: { error: 'no_auth' } };
      if (!me) return { status: 401, body: { error: 'login' } };
      if (!me.p.includes('users')) return { status: 403, body: { error: 'forbidden' } };
      if (action === 'users') return { status: 200, body: { users: auth.users.map(publicUser) } };
      if (action === 'saveUser') {
        const u = body.user as Partial<AuthUser> & { pin?: string };
        const name = String(u?.name ?? '').trim().slice(0, 40);
        const role = u?.role === 'admin' || u?.role === 'viewer' ? u.role : 'user';
        if (!name) return { status: 400, body: { error: 'bad_input' } };
        let perms = role === 'admin' ? ADMIN_PERMS : cleanPerms(u?.perms).filter((p) => p !== 'users');
        if (perms.includes('catalogEdit') && !perms.includes('catalogView')) perms = [...perms, 'catalogView'];
        const prev = auth.users.find((x) => x.id === u?.id);
        if (!prev && !PIN_RE.test(String(u?.pin ?? ''))) return { status: 400, body: { error: 'bad_pin' } };
        if (u?.pin && !PIN_RE.test(String(u.pin))) return { status: 400, body: { error: 'bad_pin' } };
        const salt = u?.pin ? randomBytes(16).toString('hex') : prev!.salt;
        const next: AuthUser = { id: prev?.id ?? randomBytes(6).toString('hex'), name, role, perms, pv: 2, salt, hash: u?.pin ? hashPin(String(u.pin), salt) : prev!.hash, disabled: !!u?.disabled };
        const users = prev ? auth.users.map((x) => (x.id === prev.id ? next : x)) : [...auth.users, next];
        if (!users.some((x) => x.role === 'admin' && !x.disabled)) return { status: 400, body: { error: 'last_admin' } };
        await saveAuth({ users });
        return { status: 200, body: { users: users.map(publicUser) } };
      }
      if (action === 'deleteUser') {
        const users = auth.users.filter((x) => x.id !== body.id);
        if (!users.some((x) => x.role === 'admin' && !x.disabled)) return { status: 400, body: { error: 'last_admin' } };
        await saveAuth({ users });
        return { status: 200, body: { users: users.map(publicUser) } };
      }
      if (action === 'invite') {
        const inv = Array.from(randomBytes(6), (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join('');
        await redis(cfg, fetcher, [['SET', `plgen:invite:${inv}`, code, 'EX', 86400]]);
        return { status: 200, body: { invite: inv, expiresIn: 86400 } };
      }
      if (action === 'orgLock') {
        await redis(cfg, fetcher, [['SET', ORG_KEY, key]]);
        return { status: 200, body: { locked: true } };
      }
      if (action === 'orgUnlock') {
        await redis(cfg, fetcher, [['DEL', ORG_KEY]]);
        return { status: 200, body: { locked: false } };
      }
      if (action === 'disable') {
        if (orgKey) return { status: 400, body: { error: 'org_locked_disable' } };
        await redis(cfg, fetcher, [['DEL', `${key}:auth`]]);
        return { status: 200, body: { enabled: false } };
      }
      return { status: 400, body: { error: 'action' } };
    }

    // protection active : rien sans session valide
    if (auth && !me) return { status: 401, body: { error: 'login' } };

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
      if (me && cur) {
        // le serveur garde la base et les réglages tels quels si le compte n'a pas le droit de les modifier
        const admin = me.p.includes('users');
        // seule l'administration modifie la base : les autres comptes passent par des propositions à valider
        if (!admin && catalogPrint(doc.catalog) !== catalogPrint(cur.catalog)) doc.catalog = cur.catalog;
        if (!admin) {
          // propositions : chacun ajoute (ou retire) les siennes ; seules les décisions de l'administrateur les clôturent
          const curP = cur.pending ?? [];
          const mine = (doc.pending ?? []).filter((x) => x?.by?.id === me.u);
          const mineIds = new Set(mine.map((x) => x.id));
          const canPropose = me.p.includes('catalogEdit') || me.p.includes('import');
          doc.pending = [...curP.filter((x) => x?.by?.id !== me.u || mineIds.has(x.id)), ...(canPropose ? mine.filter((x) => !curP.some((c) => c.id === x.id)) : [])];
          doc.pendingDone = cur.pendingDone;
        }
        // réglages protégés (identité visuelle) ; langue et mode de transport restent libres pour chacun
        if (!me.p.includes('settings')) {
          const keep = (cur.settings ?? {}) as Record<string, unknown>;
          doc.settings = { ...((doc.settings ?? {}) as Record<string, unknown>), logo: keep.logo, companyName: keep.companyName, accent: keep.accent, labels: keep.labels };
        }
        // tarifs de fret : réservés à qui a le droit de les modifier
        if (!me.p.includes('freightRates') && !me.p.includes('settings')) {
          const keep = (cur.settings ?? {}) as Record<string, unknown>;
          doc.settings = { ...((doc.settings ?? {}) as Record<string, unknown>), freightRates: keep.freightRates };
        }
        if (body.force && !me.p.includes('users')) return { status: 403, body: { error: 'forbidden' } };
      }
      if (cur && !body.force) {
        // quelqu'un (autre appareil, collègue) a enregistré depuis la dernière synchronisation de cet appareil
        if (cur.updatedAt > (body.base ?? 0)) return { status: 409, body: { error: 'conflict', doc: cur } };
        // garde-fou : une base vide n'écrase jamais une base remplie (navigateur vidé, mauvaise manipulation)
        if (cur.catalog.length > 0 && doc.catalog.length === 0) return { status: 409, body: { error: 'empty', doc: cur } };
      }
      const cmds: (string | number)[][] = [['SET', key, JSON.stringify(doc)]];
      if (cur) cmds.push(['LPUSH', `${key}:versions`, curRaw as string], ['LTRIM', `${key}:versions`, 0, VERSIONS - 1]);
      await redis(cfg, fetcher, cmds);
      return { status: 200, body: { updatedAt: doc.updatedAt, ...(me && cur && doc.catalog === cur.catalog ? { kept: true } : {}) } };
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
