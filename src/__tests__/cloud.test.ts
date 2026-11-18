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
