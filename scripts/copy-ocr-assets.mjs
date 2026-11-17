// Copie le moteur OCR (Tesseract) et la langue anglaise dans public/tesseract
// pour que l'OCR fonctionne sans dépendre d'un CDN externe.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const out = 'public/tesseract';
mkdirSync(join(out, 'core'), { recursive: true });
mkdirSync(join(out, 'lang'), { recursive: true });

const tjs = dirname(require.resolve('tesseract.js/package.json'));
cpSync(join(tjs, 'dist/worker.min.js'), join(out, 'worker.min.js'));

const core = dirname(require.resolve('tesseract.js-core/package.json'));
for (const f of readdirSync(core)) if (/lstm\.(js|wasm|wasm\.js)$/.test(f)) cpSync(join(core, f), join(out, 'core', f));

const lang = dirname(require.resolve('@tesseract.js-data/eng/package.json'));
cpSync(join(lang, '4.0.0_best_int/eng.traineddata.gz'), join(out, 'lang/eng.traineddata.gz'));
// Décodeurs d'images PDF.js (JBIG2, JPEG 2000) utilisés par les PDF scannés
const pdfjs = dirname(require.resolve('pdfjs-dist/package.json'));
cpSync(join(pdfjs, 'wasm'), 'public/pdfjs/wasm', { recursive: true });
cpSync(join(pdfjs, 'standard_fonts'), 'public/pdfjs/standard_fonts', { recursive: true });
console.log('OCR / PDF assets copied to public/');
