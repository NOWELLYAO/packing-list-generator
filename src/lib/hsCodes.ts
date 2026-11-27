/**
 * Code SH (système harmonisé, 6 chiffres, commun à tous les pays) proposé d'après la désignation.
 * Proposition à valider par le transitaire ou le déclarant : la base garde le code saisi s'il existe.
 */
const RULES: [RegExp, string, string][] = [
  // accessoires classés avec l'utilisateur (descriptions fournies le 27/11/2026)
  [/inject\.?\s*unit|canne d.injection/i, '8481.80', 'canne d’injection (robinetterie de dosage)'],
  [/acc\.?\s*(inlay|connector)/i, '3917.40', 'raccord plastique pour tuyau de dosage'],
  [/\bMI\s?301\b|grundfos go\b/i, '8517.62', 'interface Bluetooth Grundfos GO'],
  [/^\s*RSL-|canne d.aspiration|suction lance/i, '3917.23', 'conduite d’aspiration rigide en PVC (pompe doseuse)'],
  [/multiled|alarm panel/i, '8531.20', 'tableau d’alarme / signalisation à voyants'],
  [/KIT_SUC/i, '7307.99', 'kit raccord d’aspiration (accessoires de tuyauterie en acier)'],
  [/priming tank/i, '7309.00', 'réservoir d’amorçage de plus de 300 l'],
  [/KIT_TEST/i, '9026.10', 'kit d’essai pression / débit (mesure du débit)'],
  [/label\s?set/i, '4821.10', 'jeu d’étiquettes imprimées'],
  [/^\s*MSF\s?\d/i, '8501.32', 'moteur de pompe de forage solaire (courant continu, 750 W à 75 kW)'],
  [/^\s*MFV-|^\s*PLV-|^\s*manifold/i, '8481.80', 'robinetterie de dosage (soupape multifonction, maintien de pression, collecteur)'],
  [/^\s*FV-|foot valve|crépine de pied/i, '8481.30', 'crépine de pied à clapet (pompe doseuse)'],
  [/liqtec/i, '9032.89', 'protection contre la marche à sec (régulation automatique)'],
  [/\bCIM\s?\d{3}\b/i, '8517.62', 'module de communication Ethernet'],
  [/^\s*PM\s?(PLUS|START|\d)/i, '9032.20', 'régulateur de pression (pressostat + débit)'],
  [/puls\.?\s*damper|acc\.?\s*VG8|acc\.?\s*fill/i, '8413.91', 'amortisseur de pulsations / accessoire de pompe doseuse'],
  [/\bMCB\s?\d{3}\b/i, '8504.90', 'module E/S de variateur (partie de convertisseur)'],
  [/strainer/i, '8413.91', 'crépine / chemise de pompe de forage'],
  [/OVR\s?PV|surge protect|parafoudre/i, '8536.30', 'parafoudre ≤ 1 000 V'],
  [/^\s*DTS\s?\d/i, '8413.50', 'système de dosage complet (la pompe doseuse lui donne son caractère)'],
  [/power\s?adapt/i, '8537.10', 'boîtier de commande (solaire + groupe / réseau)'],
  // réservoirs à diaphragme / à vessie (GT-D, GT-U, GT-H, GT-U+) : récipient en acier sous pression d'air
  [/^\s*GT-?\s?[A-Z]{0,2}\+?\s?-?\s?\d|diaphragm tank|réservoir|bladder|expansion vessel|vase d.expansion/i, '7311.00', 'réservoir sous pression en acier'],
  // pompes doseuses (membrane, volumétriques alternatives)
  [/^\s*(DME|DDA|DDC|DDE|DDI|DMX|DMH|DMS|DMI|SMART DIGITAL)\b/i, '8413.50', 'pompe volumétrique alternative (doseuse)'],
  // joints, passe-câbles : pièces de pompes
  [/cable inlet|gasket|gaske|o-ring|joint\b/i, '8413.91', 'parties de pompes'],
  // interrupteurs à flotteur, protections moteur
  [/^\s*float switch|interrupteur à flotteur|^\s*level switch/i, '8536.50', 'interrupteur'],
  [/motor protector|^\s*MP ?204/i, '8536.30', 'appareil de protection des circuits'],
  // câbles (avant les moteurs : « Motor cable MS6000 » est un câble)
  [/(wire|cable|câble|cordon).*(mc4|connect)|mc4/i, '8544.42', 'conducteur électrique avec connecteurs'],
  [/\bcable\b|\bcâble\b|\bwire kit\b|motorcable/i, '8544.49', 'conducteur électrique ≤ 1 000 V'],
  // moteurs électriques immergés et de surface
  [/^\s*(MS|MMS)\s?-?\d|^\s*MS\d{3,4}|^\s*MG\s?\d|^\s*MMG|^\s*ML\s?\d|moteur|motor\b/i, '8501.52', 'moteur électrique à courant alternatif'],
  // variateurs, onduleurs solaires
  [/^\s*CUE\b|^\s*RSI\b|convertisseur|frequency converter|inverter/i, '8504.40', 'convertisseur statique'],
  [/sinewave|sine wave|filtre sinus/i, '8504.50', 'inductance / filtre'],
  // armoires et coffrets de commande
  [/^\s*CP\s?\d+x\d+A|\bDOL\b|GENIECON|switch box|^\s*(CU\s?\d{3}|CU\s?[23]\d\d|LC\s?\d{3}|LCD\s?\d{3}|CONTROL MPC|DC\s?\d{3}|DCD)\b|coffret|control unit|armoire/i, '8537.10', 'tableau de commande ≤ 1 000 V'],
  // chaînes de levage (pompes immergées)
  [/lift\.?\s*chain|chaîne de levage/i, '7315.82', 'chaîne à maillons soudés'],
  // chemises de refroidissement et supports des pompes immergées : parties de pompes
  [/flow sleeve|supporting ?bracket|chemise/i, '8413.91', 'parties de pompes'],
  // robinetterie, agitateurs
  [/non-return valve|check valve|clapet/i, '8481.30', 'clapet anti-retour'],
  [/PRV kit|relief valve|soupape/i, '8481.40', 'soupape de sûreté'],
  [/stirrer|agitateur|mixer/i, '8479.82', 'machine à mélanger'],
  // capteurs de pression / débit
  [/\b(RPI|DPI|RFI|VFI|MTH sensor)\b|sensor|capteur|transmitter|transmetteur/i, '9026.20', 'instrument de mesure de pression'],
  // pièces de pompes : kits, roues, garnitures, paliers, pieds d'assise
  [/^\s*(kit|spare)\b|impeller|seal|garniture|bearing|palier|shaft|arbre|roue|auto coupling|pied d.assise|ring ?stand|chamber stack|wear ring/i, '8413.91', 'parties de pompes'],
  // accouplement moteur-pompe (après les « auto coupling » de pompes, classés en parties de pompes)
  [/^\s*coupling/i, '8483.60', 'accouplement d’arbres'],
  // pompes centrifuges (immergées, multicellulaires, circulateurs, relevage, surpresseurs)
  [
    /^\s*(SP\s?\d|SPA?\d|SQ|FIRE|SBA|UPA|LS\s?\d|SL\.|SI\s?2|SQE|SQF|CR|CRN|CRI|CRE|CRT|CM|CMB|CMBE|CME|NB|NBE|NBG|NK|NKE|NKG|TP|TPE|MAGNA|UPS|UPM|ALPHA|COMFORT|SEG|SEV|SL1|SLV|SE1|SEV|AP\s?\d|AP\d|UNILIFT|MULTIBOX|HYDRO|JP|SCALA|DP\s?\d|EF\s?\d|KP\s?\d|MTR|MTH|MTA|SB\s?\d|S\s?\d|SRP|AMD|AFG|SMD|SRG|DW|DWK|BM|BMB|SPK|MQ|CHI|CH\s?\d|CHV|CMV)/i,
    '8413.70',
    'pompe centrifuge',
  ],
];

export function suggestHs(description: string): { code: string; label: string; matched: string } | null {
  const d = description ?? '';
  for (const [re, code, label] of RULES) {
    const m = d.match(re);
    if (m) return { code, label, matched: m[0].trim() };
  }
  return null;
}

/** Libellés officiels (Système harmonisé, 6 chiffres) des positions proposées par l'application */
export const HS_TITLES: Record<string, { title: string; chapter: string; examples: string }> = {
  '7311.00': {
    title: 'Récipients pour gaz comprimés ou liquéfiés, en fonte, fer ou acier',
    chapter: 'Chapitre 73 · position 73.11 Récipients pour gaz comprimés',
    examples: 'Réservoirs à diaphragme ou à vessie GT-D, GT-U, GT-H (coussin d’air sous pression). Classement discuté : certains déclarants retiennent 7309 / 7310 (réservoirs, selon la capacité) — à confirmer avec votre transitaire',
  },
  '8481.80': { title: 'Autres articles de robinetterie et organes similaires', chapter: 'Chapitre 84 · position 84.81 Robinetterie', examples: 'Cannes d’injection, soupapes multifonctions, soupapes de maintien de pression, collecteurs de dosage' },
  '3917.40': { title: 'Accessoires de tuyauterie en matières plastiques (raccords, coudes…)', chapter: 'Chapitre 39 · position 39.17 Tubes et tuyaux en plastique', examples: 'Raccords et inserts plastiques pour tuyaux de dosage' },
  '3917.23': { title: 'Tubes et tuyaux rigides en polymères du chlorure de vinyle (PVC)', chapter: 'Chapitre 39 · position 39.17 Tubes et tuyaux en plastique', examples: 'Conduites d’aspiration rigides de pompes doseuses (si elles intègrent un détecteur de niveau, 8413.91 se discute)' },
  '8517.62': { title: 'Appareils pour la réception, la conversion et la transmission de données', chapter: 'Chapitre 85 · position 85.17 Appareils de télécommunication', examples: 'Interface Bluetooth Grundfos GO (MI301), modules Ethernet CIM' },
  '8531.20': { title: 'Panneaux indicateurs à cristaux liquides ou à diodes émettrices de lumière (LED)', chapter: 'Chapitre 85 · position 85.31 Appareils de signalisation acoustique ou visuelle', examples: 'Tableaux d’alarme de groupes incendie (Multiled)' },
  '7307.99': { title: 'Autres accessoires de tuyauterie en fer ou en acier', chapter: 'Chapitre 73 · position 73.07 Accessoires de tuyauterie', examples: 'Kits de raccords d’aspiration (cônes, manchettes) de groupes incendie' },
  '7309.00': { title: 'Réservoirs, cuves et récipients de plus de 300 l, en fonte, fer ou acier', chapter: 'Chapitre 73 · position 73.09', examples: 'Réservoir d’amorçage 500 l de groupe incendie (en plastique : 3925.10)' },
  '9026.10': { title: 'Instruments pour la mesure ou le contrôle du débit ou du niveau des liquides', chapter: 'Chapitre 90 · position 90.26', examples: 'Kits d’essai débit / pression de groupes incendie (débitmètre)' },
  '4821.10': { title: 'Étiquettes en papier ou carton, imprimées', chapter: 'Chapitre 48 · position 48.21', examples: 'Jeux d’étiquettes (en plastique adhésif : 3919)' },
  '8501.32': { title: 'Moteurs à courant continu, d’une puissance de plus de 750 W à 75 kW', chapter: 'Chapitre 85 · position 85.01 Moteurs et générateurs électriques', examples: 'Moteurs solaires MSF (SQFlex), alimentés en courant continu ou alternatif — à confirmer' },
  '9032.89': { title: 'Autres instruments et appareils pour la régulation ou le contrôle automatiques', chapter: 'Chapitre 90 · position 90.32', examples: 'Protections contre la marche à sec LiqTec' },
  '9032.20': { title: 'Manostats (pressostats)', chapter: 'Chapitre 90 · position 90.32', examples: 'Régulateurs de pression PM 1, PM 2, PM PLUS, PM START' },
  '8483.60': { title: 'Embrayages et organes d’accouplement, y compris les joints d’articulation', chapter: 'Chapitre 84 · position 84.83', examples: 'Accouplements moteur-pompe' },
  '8504.90': { title: 'Parties de transformateurs, convertisseurs statiques et bobines', chapter: 'Chapitre 85 · position 85.04', examples: 'Modules d’entrées / sorties pour variateurs (MCB)' },
  '7315.82': {
    title: 'Autres chaînes à maillons soudés, en fonte, fer ou acier',
    chapter: 'Chapitre 73 · position 73.15 Chaînes et chaînettes',
    examples: 'Chaînes de levage inox pour pompes immergées',
  },
  '8413.50': {
    title: 'Autres pompes volumétriques alternatives (pour liquides)',
    chapter: 'Chapitre 84 · position 84.13 Pompes pour liquides',
    examples: 'Pompes doseuses à membrane : DDA, DDC, DDE, DME, DMX, DMH, DMS',
  },
  '8413.70': {
    title: 'Autres pompes centrifuges (pour liquides)',
    chapter: 'Chapitre 84 · position 84.13 Pompes pour liquides',
    examples: 'Pompes immergées SP / SQ, multicellulaires CR, NB / NK / TP, circulateurs MAGNA / UPS / ALPHA, relevage, surpresseurs Hydro',
  },
  '8413.91': {
    title: 'Parties de pompes pour liquides',
    chapter: 'Chapitre 84 · position 84.13 Pompes pour liquides',
    examples: 'Kits de roues, garnitures mécaniques, paliers, joints, pieds d’assise, accouplements',
  },
  '8501.52': {
    title: 'Moteurs à courant alternatif polyphasés, d’une puissance de plus de 750 W à 75 kW',
    chapter: 'Chapitre 85 · position 85.01 Moteurs et générateurs électriques',
    examples: 'Moteurs immergés MS, MMS ; moteurs de surface MG, ML (vérifier : monophasé → 8501.40, plus de 75 kW → 8501.53)',
  },
  '8504.40': {
    title: 'Convertisseurs statiques',
    chapter: 'Chapitre 85 · position 85.04 Transformateurs, convertisseurs, bobines',
    examples: 'Variateurs de fréquence CUE, onduleurs solaires RSI',
  },
  '8504.50': {
    title: 'Autres bobines de réactance et autres selfs',
    chapter: 'Chapitre 85 · position 85.04 Transformateurs, convertisseurs, bobines',
    examples: 'Filtres sinus (Sinewave) pour variateurs',
  },
  '8537.10': {
    title: 'Tableaux et armoires de commande électrique, pour une tension n’excédant pas 1 000 V',
    chapter: 'Chapitre 85 · position 85.37 Tableaux, panneaux, armoires de commande',
    examples: 'Coffrets CU, LC, Control MPC, armoires de commande',
  },
  '8536.50': {
    title: 'Autres interrupteurs, sectionneurs et commutateurs (≤ 1 000 V)',
    chapter: 'Chapitre 85 · position 85.36 Appareillage pour circuits électriques ≤ 1 000 V',
    examples: 'Interrupteurs à flotteur, détecteurs de niveau',
  },
  '8536.30': {
    title: 'Autres appareils pour la protection des circuits électriques (≤ 1 000 V)',
    chapter: 'Chapitre 85 · position 85.36 Appareillage pour circuits électriques ≤ 1 000 V',
    examples: 'Protections moteur MP 204',
  },
  '8544.42': {
    title: 'Autres conducteurs électriques pour tension ≤ 1 000 V, munis de pièces de connexion',
    chapter: 'Chapitre 85 · position 85.44 Fils et câbles isolés',
    examples: 'Kits de câbles avec connecteurs MC4',
  },
  '8544.49': {
    title: 'Autres conducteurs électriques pour tension ≤ 1 000 V, sans pièces de connexion',
    chapter: 'Chapitre 85 · position 85.44 Fils et câbles isolés',
    examples: 'Câbles moteur, câbles d’alimentation au mètre',
  },
  '9026.20': {
    title: 'Instruments et appareils pour la mesure ou le contrôle de la pression',
    chapter: 'Chapitre 90 · position 90.26 Mesure du débit, du niveau, de la pression',
    examples: 'Capteurs et transmetteurs de pression (RPI, DPI) ; un débitmètre relève plutôt de 9026.10',
  },
  '8481.30': {
    title: 'Clapets et soupapes de retenue',
    chapter: 'Chapitre 84 · position 84.81 Robinetterie',
    examples: 'Clapets anti-retour',
  },
  '8481.40': {
    title: 'Soupapes de trop-plein ou de sûreté',
    chapter: 'Chapitre 84 · position 84.81 Robinetterie',
    examples: 'Kits de soupape de sûreté (PRV)',
  },
  '8479.82': {
    title: 'Machines et appareils à mélanger, malaxer, broyer, homogénéiser',
    chapter: 'Chapitre 84 · position 84.79 Machines ayant une fonction propre',
    examples: 'Agitateurs électriques pour bacs de dosage',
  },
};

/** description d'un code SH (6 premiers chiffres) s'il est connu de l'application */
export function describeHs(code: string) {
  const c = (code || '').replace(/[^\d]/g, '');
  if (c.length < 6) return null;
  const key = `${c.slice(0, 4)}.${c.slice(4, 6)}`;
  return HS_TITLES[key] ? { key, ...HS_TITLES[key] } : null;
}

/**
 * Emballage proposé d'après le produit (désignation), affiné par le poids et les dimensions s'ils sont connus.
 * D'après vos PL Grundfos : pompes immergées en caisse dès 50 kg, CR lourdes sur palette étroite,
 * surpresseurs en carton sur palette, petits articles en carton.
 */
export function suggestPackaging(description: string, gross = 0, l = 0, w = 0): { type: string; reason: string } {
  const d = description ?? '';
  const [L, W] = [Math.max(l, w), Math.min(l, w)];
  if (/^\s*(SP\s?\d|SPA?\d|SQ|SQE|SQF)/i.test(d))
    return gross >= 50 ? { type: 'Caisse', reason: 'pompe immergée de 50 kg ou plus : caisse bois' } : { type: 'Carton', reason: 'pompe immergée légère : carton long' };
  if (/^\s*CR[A-Z]{0,2}\s?\d/i.test(d))
    return gross >= 80 ? { type: 'Palette étroite', reason: 'pompe CR lourde : vissée sur palette étroite' } : { type: 'Carton', reason: 'petite pompe CR : carton (Pre-Pack)' };
  if (/hydro\s*(multi|mpc|solo)|booster|surpresseur|fire\s*\d|^\s*si\s?2/i.test(d))
    return { type: 'Carton sur palette', reason: 'surpresseur / groupe : carton sur palette' };
  if (/^\s*GT-?/i.test(d)) return gross >= 50 ? { type: 'Palette', reason: 'gros réservoir : palette' } : { type: 'Carton', reason: 'réservoir : carton' };
  if (/^\s*(MS|MMS)\s?-?\d|^\s*MS\d{3,4}/i.test(d)) return gross >= 50 ? { type: 'Caisse', reason: 'moteur immergé lourd : caisse' } : { type: 'Carton', reason: 'moteur immergé : carton' };
  if (/cable|câble|plug|flange|kit|spare|seal|sensor|switch|module|labelset|acc\./i.test(d) && !(gross >= 50))
    return { type: 'Carton', reason: 'accessoire / pièce : carton' };
  // sinon : poids et dimensions
  if (gross >= 150 || (L >= 100 && W >= 60)) return { type: 'Palette', reason: 'plus de 150 kg ou grande emprise : palette' };
  if (gross >= 50) return { type: 'Caisse', reason: 'plus de 50 kg : caisse' };
  return { type: 'Carton', reason: 'article léger : carton' };
}
