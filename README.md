# 📦 PL Generator

Application web (React + TypeScript + Vite) qui génère des **Packing Lists** à partir des Packing Lists que vous avez déjà émises.

## Fonctionnement

1. **Importer des PL** (Excel `.xlsx/.xls`, CSV, PDF texte)
   - Détection automatique de la ligne d'en-tête et des colonnes (FR/EN) : code article, PN, désignation, quantité, unité, nb colis, emballage, dimensions (`120x80x100`, ou colonnes L/l/H), poids net/brut, volume, code SH, origine.
   - Association des colonnes modifiable avant validation.
   - Unités des dimensions détectées (mm / cm / m) et converties en cm.
   - Les poids peuvent être des totaux par ligne, par unité ou par colis.
   - Caisses partagées (cellules fusionnées) : poids et colis répartis au prorata des quantités.
   - Lignes « Total » ignorées.
2. **Base articles** : chaque article est stocké avec quantité par colis, dimensions du colis et poids unitaires. Tout est modifiable ; export Excel, sauvegarde / restauration JSON.
3. **Générer une PL** : saisissez code article et/ou PN + quantité (saisie manuelle, collage depuis Excel ou import d'un fichier). L'application calcule :
   - nombre de colis (`⌈quantité / qté par colis⌉`) et numérotation des colis,
   - poids net et brut, volume (m³), totaux,
   - signale les articles introuvables ou incomplets.
   
   Export **Excel**, **PDF** ou impression.

Les données sont conservées dans le navigateur (localStorage). Pensez à faire une sauvegarde JSON régulière.

## Développement

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # build de production dans dist/
```

## Déploiement Vercel

Le dépôt contient `vercel.json`. Sur [vercel.com/new](https://vercel.com/new), importez ce dépôt GitHub : le framework Vite est détecté, aucune variable d'environnement n'est nécessaire. Chaque push sur `main` redéploie automatiquement.
