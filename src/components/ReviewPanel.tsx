import { useState } from 'react';
import type { CatalogItem, PendingChange } from '../types';
import { applyChange, fieldChanges } from '../lib/review';
import { itemKey } from '../lib/normalize';
import ItemEditor from './ItemEditor';

interface Props {
  pending: PendingChange[];
  catalog: CatalogItem[];
  /** applique à la base (administrateur) */
  setCatalog: (c: CatalogItem[]) => void;
  /** met à jour la file (proposition modifiée) */
  setPending: (p: PendingChange[]) => void;
  /** retire une proposition traitée */
  resolve: (id: string) => void;
  toast: (m: string) => void;
}

const when = (s: string) => new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

/** Administrateur : propositions de modification des utilisateurs à approuver, modifier ou refuser */
export default function ReviewPanel({ pending, catalog, setCatalog, setPending, resolve, toast }: Props) {
  const [open, setOpen] = useState<string | null>(pending[0]?.id ?? null);
  const [editing, setEditing] = useState<{ change: string; item: CatalogItem } | null>(null);
  const byKey = new Map(catalog.map((i) => [itemKey(i.code, i.pn), i]));

  const approve = (c: PendingChange, part?: Pick<PendingChange, 'upserts' | 'removals'>) => {
    setCatalog(applyChange(catalog, part ?? c));
    if (!part || (part.upserts.length === c.upserts.length && part.removals.length === c.removals.length)) {
      resolve(c.id);
      toast(`Approuvé : ${c.label}`);
    } else {
      // approbation partielle : le reste reste en attente
      const keep = { ...c, upserts: c.upserts.filter((u) => !part.upserts.includes(u)), removals: c.removals.filter((r) => !part.removals.includes(r)) };
      setPending(pending.map((p) => (p.id === c.id ? keep : p)));
      toast('Élément approuvé');
    }
  };
  const dropPart = (c: PendingChange, u?: CatalogItem, r?: PendingChange['removals'][number]) => {
    const keep = { ...c, upserts: c.upserts.filter((x) => x !== u), removals: c.removals.filter((x) => x !== r) };
    if (!keep.upserts.length && !keep.removals.length) resolve(c.id);
    else setPending(pending.map((p) => (p.id === c.id ? keep : p)));
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Validation des modifications</h2>
          <p className="hint">
            Les changements faits par les utilisateurs (fiches modifiées, ajoutées ou supprimées, imports de PL et de fiches SAP) n'entrent dans la base
            qu'après votre accord.
          </p>
        </div>
      </div>
      {!pending.length && <div className="empty">Aucune modification en attente.</div>}
      {pending.map((c) => {
        const isOpen = open === c.id;
        const added = c.upserts.filter((u) => !byKey.has(itemKey(u.code, u.pn)));
        const changed = c.upserts.filter((u) => byKey.has(itemKey(u.code, u.pn)));
        return (
          <section key={c.id} className="card review-card">
            <button className="review-head" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen}>
              <span>
                <b>{c.label}</b>
                <small className="hint">
                  {' '}
                  · {c.by.name} · {when(c.at)}
                </small>
              </span>
              <span className="hint">
                {added.length ? `${added.length} ajout${added.length > 1 ? 's' : ''} ` : ''}
                {changed.length ? `${changed.length} modif. ` : ''}
                {c.removals.length ? `${c.removals.length} suppr.` : ''}
              </span>
            </button>
            {isOpen && (
              <div className="review-body">
                {c.upserts.map((u, i) => {
                  const before = byKey.get(itemKey(u.code, u.pn));
                  const diffs = fieldChanges(before, u);
                  return (
                    <div key={i} className="review-item">
                      <div>
                        <b className="mono">{u.code}</b> {u.description}
                        <span className={`chip ${before ? 'chip-accent' : 'chip-warn'}`}>{before ? 'modifiée' : 'nouvelle'}</span>
                        {before ? (
                          diffs.length ? (
                            <ul className="review-diff">
                              {diffs.map((d) => (
                                <li key={d.label}>
                                  {d.label} : <s>{d.from}</s> → <b>{d.to}</b>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <small className="hint"> (détails techniques seulement)</small>
                          )
                        ) : (
                          <small className="hint">
                            {' '}
                            {u.qtyPerPackage} / {u.packageType}
                            {u.length ? ` · ${u.length}×${u.width}×${u.height} cm` : ''} · brut {u.grossWeightPerUnit} kg/u
                          </small>
                        )}
                      </div>
                      <div className="row wrap">
                        <button className="btn small primary" onClick={() => approve(c, { upserts: [u], removals: [] })}>
                          Approuver
                        </button>
                        <button className="btn small" onClick={() => setEditing({ change: c.id, item: u })}>
                          Modifier
                        </button>
                        <button className="btn small ghost danger" onClick={() => dropPart(c, u)}>
                          Refuser
                        </button>
                      </div>
                    </div>
                  );
                })}
                {c.removals.map((r) => (
                  <div key={r.key} className="review-item">
                    <div>
                      <b className="mono">{r.code}</b> {r.description} <span className="chip chip-danger">suppression</span>
                    </div>
                    <div className="row wrap">
                      <button className="btn small primary" onClick={() => approve(c, { upserts: [], removals: [r] })}>
                        Approuver
                      </button>
                      <button className="btn small ghost danger" onClick={() => dropPart(c, undefined, r)}>
                        Refuser
                      </button>
                    </div>
                  </div>
                ))}
                <div className="row wrap review-all">
                  <button className="btn primary" onClick={() => approve(c)}>
                    Tout approuver
                  </button>
                  <button
                    className="btn ghost danger"
                    onClick={() => {
                      resolve(c.id);
                      toast(`Refusé : ${c.label}`);
                    }}
                  >
                    Tout refuser
                  </button>
                </div>
              </div>
            )}
          </section>
        );
      })}
      {editing && (
        <ItemEditor
          item={editing.item}
          onClose={() => setEditing(null)}
          onDelete={() => setEditing(null)}
          onSave={(it) => {
            setPending(pending.map((p) => (p.id === editing.change ? { ...p, upserts: p.upserts.map((u) => (u === editing.item ? it : u)) } : p)));
            setEditing(null);
            toast('Proposition modifiée : approuvez-la pour l’appliquer');
          }}
        />
      )}
    </div>
  );
}
