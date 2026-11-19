import { describe, expect, it } from 'vitest';
import { handle } from '../../api/base';
import { isValidCode, mergeDocs, newSpaceCode, normalizeCode, type CloudDoc } from '../lib/cloud';
import { CATALOG } from './fixtures';

/** Upstash Redis simulé (commandes utilisées par le service) */
function fakeRedis() {
  const kv = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const fetcher = async (_url: string, init: { body: string }) => {
    const cmds = JSON.parse(init.body) as (string | number)[][];
    const out = cmds.map(([c, k, a, b]) => {
      const key = String(k);
      switch (c) {
        case 'GET':
          return { result: kv.get(key) ?? null };
        case 'SET':
          kv.set(key, String(a));
          return { result: 'OK' };
        case 'LPUSH':
          lists.set(key, [String(a), ...(lists.get(key) ?? [])]);
          return { result: lists.get(key)!.length };
        case 'LTRIM':
          lists.set(key, (lists.get(key) ?? []).slice(Number(a), Number(b) + 1));
          return { result: 'OK' };
        case 'LRANGE':
          return { result: (lists.get(key) ?? []).slice(Number(a), Number(b) + 1) };
        case 'INCR':
          kv.set(key, String(Number(kv.get(key) ?? 0) + 1));
          return { result: Number(kv.get(key)) };
        case 'EXPIRE':
          return { result: 1 };
        case 'DEL':
          kv.delete(key);
          return { result: 1 };
        case 'LINDEX':
          return { result: (lists.get(key) ?? [])[Number(a)] ?? null };
        default:
          return { error: 'unknown ' + c };
      }
    });
    return { ok: true, status: 200, json: async () => out };
  };
  return { fetcher, kv };
}

const env = { KV_REST_API_URL: 'https://fake.upstash.io', KV_REST_API_TOKEN: 't' };
const CODE = 'PL-ABCD-EFGH-JKLM-NPQR';
const h = { 'x-plgen-space': CODE };
const doc = (n: number, at: number): CloudDoc => ({ updatedAt: at, catalog: CATALOG.slice(0, n), history: [], accuracy: [] });

describe('sauvegarde en ligne : service serveur', () => {
  it('sans stockage configuré : 503 (message d’activation côté appli)', async () => {
    const r = await handle({ method: 'GET', headers: h }, {}, fakeRedis().fetcher);
    expect(r.status).toBe(503);
  });
  it('stockage connecté avec un préfixe personnalisé (STORAGE_…) reconnu', async () => {
    const r = await handle({ method: 'GET', headers: h }, { STORAGE_REST_API_URL: 'https://x.upstash.io', STORAGE_REST_API_TOKEN: 't' }, fakeRedis().fetcher);
    expect(r.status).toBe(404);
  });
  it('code invalide refusé', async () => {
    const r = await handle({ method: 'GET', headers: { 'x-plgen-space': 'court' } }, env, fakeRedis().fetcher);
    expect(r.status).toBe(400);
  });
  it('écrit, relit, garde les versions précédentes', async () => {
    const { fetcher, kv } = fakeRedis();
    expect((await handle({ method: 'GET', headers: h }, env, fetcher)).status).toBe(404);
    expect((await handle({ method: 'PUT', headers: h, body: { doc: doc(3, 1000), base: 0 } }, env, fetcher)).status).toBe(200);
    expect((await handle({ method: 'PUT', headers: h, body: { doc: doc(4, 2000), base: 1000 } }, env, fetcher)).status).toBe(200);
    const g = await handle({ method: 'GET', headers: h }, env, fetcher);
    expect((g.body as { doc: CloudDoc }).doc.catalog).toHaveLength(4);
    const v = await handle({ method: 'GET', headers: h, query: { versions: '1' } }, env, fetcher);
    expect((v.body as { versions: { articles: number }[] }).versions[0].articles).toBe(3);
    // la clé de stockage ne contient pas le code en clair
    expect([...kv.keys()].some((k) => k.includes(CODE))).toBe(false);
  });
  it('conflit : un autre appareil a écrit depuis → 409 avec la version en ligne', async () => {
    const { fetcher } = fakeRedis();
    await handle({ method: 'PUT', headers: h, body: { doc: doc(3, 1000), base: 0 } }, env, fetcher);
    const r = await handle({ method: 'PUT', headers: h, body: { doc: doc(2, 1500), base: 500 } }, env, fetcher);
    expect(r.status).toBe(409);
    expect((r.body as { error: string }).error).toBe('conflict');
  });
  it('garde-fou : une base vide n’écrase jamais une base remplie', async () => {
    const { fetcher } = fakeRedis();
    await handle({ method: 'PUT', headers: h, body: { doc: doc(3, 1000), base: 0 } }, env, fetcher);
    const r = await handle({ method: 'PUT', headers: h, body: { doc: doc(0, 2000), base: 1000 } }, env, fetcher);
    expect(r.status).toBe(409);
    expect((r.body as { error: string }).error).toBe('empty');
    const g = await handle({ method: 'GET', headers: h }, env, fetcher);
    expect((g.body as { doc: CloudDoc }).doc.catalog).toHaveLength(3);
  });
});

describe('sauvegarde en ligne : appareil', () => {
  it('codes générés valides, saisie tolérante', () => {
    const c = newSpaceCode();
    expect(isValidCode(c)).toBe(true);
    expect(normalizeCode(' pl abcd efgh jklm npqr ')).toBe('PL-ABCD-EFGH-JKLM-NPQR');
  });
  it('fusion : tous les articles, la fiche la plus récente pour un même article', () => {
    const a = { ...CATALOG[0], updatedAt: '2026-11-01T00:00:00Z', description: 'ancienne' };
    const b = { ...CATALOG[0], updatedAt: '2026-11-10T00:00:00Z', description: 'récente' };
    const m = mergeDocs({ catalog: [a, CATALOG[1]], history: [], accuracy: [] }, { updatedAt: 1, catalog: [b, CATALOG[2]], history: [], accuracy: [] });
    expect(m.catalog).toHaveLength(3);
    expect(m.catalog.find((x) => x.code === CATALOG[0].code)!.description).toBe('récente');
  });
});


describe('contrôle d’accès (administrateur, utilisateurs, droits)', () => {
  const post = (fetcher: never, body: unknown, token?: string) => handle({ method: 'POST', headers: { ...h, ...(token ? { 'x-plgen-token': token } : {}) }, body }, env, fetcher);
  it('protection : création de l’admin, connexion, refus sans jeton, droits appliqués par le serveur', async () => {
    const { fetcher } = fakeRedis();
    const f = fetcher as never;
    await handle({ method: 'PUT', headers: h, body: { doc: doc(3, 1000), base: 0 } }, env, fetcher);
    expect(((await post(f, { action: 'status' })).body as { enabled: boolean }).enabled).toBe(false);
    const setup = await post(f, { action: 'setup', name: 'Admin', pin: '1234' });
    expect(setup.status).toBe(200);
    const adminTok = (setup.body as { token: string }).token;
    expect((await post(f, { action: 'setup', name: 'X', pin: '9999' })).status).toBe(409);
    // sans jeton : plus rien
    expect((await handle({ method: 'GET', headers: h }, env, fetcher)).status).toBe(401);
    // l'admin crée un préparateur (sans droit de modifier la base)
    const su = await post(f, { action: 'saveUser', user: { name: 'Préparateur', role: 'user', perms: ['generate', 'export', 'history', 'catalogView'], pin: '5678' } }, adminTok);
    expect(su.status).toBe(200);
    const prep = (su.body as { users: { id: string; name: string }[] }).users.find((u) => u.name === 'Préparateur')!;
    expect((await post(f, { action: 'login', userId: prep.id, pin: '0000' })).status).toBe(401);
    const lg = await post(f, { action: 'login', userId: prep.id, pin: '5678' });
    expect(lg.status).toBe(200);
    const prepTok = (lg.body as { token: string }).token;
    // le préparateur ne gère pas les utilisateurs
    expect((await post(f, { action: 'users' }, prepTok)).status).toBe(403);
    // il peut lire et pousser son historique, mais pas changer la base d'articles
    const r0 = await handle({ method: 'GET', headers: { ...h, 'x-plgen-token': prepTok } }, env, fetcher);
    expect(r0.status).toBe(200);
    const d = { ...doc(1, 2000), history: [{ id: 'h1', createdAt: 'x' }] };
    expect((await handle({ method: 'PUT', headers: { ...h, 'x-plgen-token': prepTok }, body: { doc: d, base: 1000 } }, env, fetcher)).status).toBe(200);
    const after = (await handle({ method: 'GET', headers: { ...h, 'x-plgen-token': adminTok } }, env, fetcher)).body as { doc: CloudDoc };
    expect(after.doc.catalog.length).toBe(3);
    expect(after.doc.history?.length).toBe(1);
    // un jeton falsifié est refusé
    expect((await handle({ method: 'GET', headers: { ...h, 'x-plgen-token': prepTok.slice(0, -2) + 'xx' } }, env, fetcher)).status).toBe(401);
    // le dernier administrateur ne peut pas être supprimé
    const admins = ((await post(f, { action: 'users' }, adminTok)).body as { users: { id: string; role: string }[] }).users.filter((u) => u.role === 'admin');
    expect((await post(f, { action: 'deleteUser', id: admins[0].id }, adminTok)).status).toBe(400);
  });
  it('8 codes faux → compte bloqué', async () => {
    const { fetcher } = fakeRedis();
    const f = fetcher as never;
    await post(f, { action: 'setup', name: 'Admin', pin: '1234' });
    const id = ((await post(f, { action: 'status' })).body as { users: { id: string }[] }).users[0].id;
    for (let i = 0; i < 8; i++) await post(f, { action: 'login', userId: id, pin: '0000' });
    expect((await post(f, { action: 'login', userId: id, pin: '1234' })).status).toBe(429);
  });
});


describe('propositions de modification (validation par l’administrateur)', () => {
  const post = (fetcher: never, body: unknown, token?: string) => handle({ method: 'POST', headers: { ...h, ...(token ? { 'x-plgen-token': token } : {}) }, body }, env, fetcher);
  it('un responsable base ne modifie pas la base directement ; sa proposition est conservée, l’admin la clôture', async () => {
    const { fetcher } = fakeRedis();
    const f = fetcher as never;
    await handle({ method: 'PUT', headers: h, body: { doc: doc(3, 1000), base: 0 } }, env, fetcher);
    const adminTok = ((await post(f, { action: 'setup', name: 'Admin', pin: '1234' })).body as { token: string }).token;
    const su = await post(f, { action: 'saveUser', user: { name: 'Resp', role: 'user', perms: ['generate', 'catalogView', 'catalogEdit', 'import'], pin: '5678' } }, adminTok);
    const id = (su.body as { users: { id: string; name: string }[] }).users.find((u) => u.name === 'Resp')!.id;
    const tok = ((await post(f, { action: 'login', userId: id, pin: '5678' })).body as { token: string }).token;
    const prop = { id: 'p1', at: 'x', by: { id, name: 'Resp' }, label: 'Ajout', upserts: [CATALOG[4]], removals: [] };
    const d = { ...doc(4, 2000), pending: [prop] };
    await handle({ method: 'PUT', headers: { ...h, 'x-plgen-token': tok }, body: { doc: d, base: 1000 } }, env, fetcher);
    let cur = ((await handle({ method: 'GET', headers: { ...h, 'x-plgen-token': adminTok } }, env, fetcher)).body as { doc: CloudDoc }).doc;
    expect(cur.catalog.length).toBe(3);
    expect(cur.pending?.length).toBe(1);
    // l'admin approuve : base modifiée, proposition close
    await handle({ method: 'PUT', headers: { ...h, 'x-plgen-token': adminTok }, body: { doc: { ...cur, catalog: CATALOG.slice(0, 4), pending: [], pendingDone: ['p1'], updatedAt: 3000 }, base: cur.updatedAt } }, env, fetcher);
    cur = ((await handle({ method: 'GET', headers: { ...h, 'x-plgen-token': adminTok } }, env, fetcher)).body as { doc: CloudDoc }).doc;
    expect(cur.catalog.length).toBe(4);
    expect(cur.pending?.length).toBe(0);
  });
});
