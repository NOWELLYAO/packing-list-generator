# 📦 PL Generator

Application web (React + TypeScript + Vite) qui génère des **Packing Lists** à partir des Packing Lists que vous avez déjà émises.

👉 **Application en ligne : https://plgen.vercel.app** (installable sur téléphone : Partager → Sur l'écran d'accueil)

## Fonctionnement

1. **Importer des PL** (Excel `.xlsx/.xls`, CSV, PDF texte ou scanné)
   - **PL au format SAP / Grundfos** (« Hand. unit / Material / Gross wt. KG / Dimens. CM ») : import direct, colis par colis.
     Les PDF scannés sont lus par OCR dans le navigateur (Tesseract, embarqué dans l'application, aucun envoi externe).
     Un article réparti sur plusieurs caisses (quantité 0,5) est géré ; les articles de colis mixtes sont marqués ⚠️
     et ne remplacent jamais une fiche issue d'un colis dédié.
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

## Fichiers embarqués

`npm run dev` / `npm run build` lancent `scripts/copy-ocr-assets.mjs`, qui copie dans `public/` le moteur OCR,
la langue anglaise et les décodeurs d'images PDF.js (JBIG2, JPEG 2000). Ces fichiers ne sont pas versionnés.

## Développement

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # build de production dans dist/
```

## Déploiement Vercel

Le dépôt contient `vercel.json`. Sur [vercel.com/new](https://vercel.com/new), importez ce dépôt GitHub : le framework Vite est détecté, aucune variable d'environnement n'est nécessaire. Chaque push sur `main` redéploie automatiquement.
