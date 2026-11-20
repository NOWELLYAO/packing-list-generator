/**
 * Code SH (système harmonisé, 6 chiffres, commun à tous les pays) proposé d'après la désignation.
 * Proposition à valider par le transitaire ou le déclarant : la base garde le code saisi s'il existe.
 */
const RULES: [RegExp, string, string][] = [
  // pompes doseuses (membrane, volumétriques alternatives)
  [/^\s*(DME|DDA|DDC|DDE|DDI|DMX|DMH|DMS|DMI|SMART DIGITAL)\b/i, '8413.50', 'pompe volumétrique alternative (doseuse)'],
  // joints, passe-câbles : pièces de pompes
  [/cable inlet|gasket|gaske|o-ring|joint\b/i, '8413.91', 'parties de pompes'],
  // interrupteurs à flotteur, protections moteur
  [/^\s*float switch|interrupteur à flotteur|^\s*level switch/i, '8536.50', 'interrupteur'],
  [/motor protector|^\s*MP ?204/i, '8536.30', 'appareil de protection des circuits'],
  // câbles (avant les moteurs : « Motor cable MS6000 » est un câble)
  [/(wire|cable|câble|cordon).*(mc4|connect)|mc4/i, '8544.42', 'conducteur électrique avec connecteurs'],
  [/\bcable\b|\bcâble\b|\bwire kit\b/i, '8544.49', 'conducteur électrique ≤ 1 000 V'],
  // moteurs électriques immergés et de surface
  [/^\s*(MS|MMS)\s?-?\d|^\s*MS\d{3,4}|^\s*MG\s?\d|^\s*MMG|^\s*ML\s?\d|moteur|motor\b/i, '8501.52', 'moteur électrique à courant alternatif'],
  // variateurs, onduleurs solaires
  [/^\s*CUE\b|^\s*RSI\b|convertisseur|frequency converter|inverter/i, '8504.40', 'convertisseur statique'],
  [/sinewave|sine wave|filtre sinus/i, '8504.50', 'inductance / filtre'],
  // armoires et coffrets de commande
  [/^\s*(CU\s?\d{3}|CU\s?[23]\d\d|LC\s?\d{3}|LCD\s?\d{3}|CONTROL MPC|DC\s?\d{3}|DCD)\b|coffret|control unit|armoire/i, '8537.10', 'tableau de commande ≤ 1 000 V'],
  // robinetterie, agitateurs
  [/non-return valve|check valve|clapet/i, '8481.30', 'clapet anti-retour'],
  [/PRV kit|relief valve|soupape/i, '8481.40', 'soupape de sûreté'],
  [/stirrer|agitateur|mixer/i, '8479.82', 'machine à mélanger'],
  // capteurs de pression / débit
  [/\b(RPI|DPI|RFI|VFI|MTH sensor)\b|sensor|capteur|transmitter|transmetteur/i, '9026.20', 'instrument de mesure de pression'],
  // pièces de pompes : kits, roues, garnitures, paliers, pieds d'assise
  [/^\s*(kit|spare)\b|impeller|seal|garniture|bearing|palier|shaft|arbre|roue|auto coupling|pied d.assise|ring ?stand|chamber stack|wear ring/i, '8413.91', 'parties de pompes'],
  // pompes centrifuges (immergées, multicellulaires, circulateurs, relevage, surpresseurs)
  [
    /^\s*(SP\s?\d|SPA?\d|SQ|FIRE|SBA|UPA|LS\s?\d|SL\.|SI\s?2|SQE|SQF|CR|CRN|CRI|CRE|CRT|CM|CMB|CMBE|CME|NB|NBE|NBG|NK|NKE|NKG|TP|TPE|MAGNA|UPS|UPM|ALPHA|COMFORT|SEG|SEV|SL1|SLV|SE1|SEV|AP\s?\d|AP\d|UNILIFT|MULTIBOX|HYDRO|JP|SCALA|DP\s?\d|EF\s?\d|KP\s?\d|MTR|MTH|MTA|SB\s?\d|S\s?\d|SRP|AMD|AFG|SMD|SRG|DW|DWK|BM|BMB|SPK|MQ|CHI|CH\s?\d|CHV|CMV)/i,
    '8413.70',
    'pompe centrifuge',
  ],
];

export function suggestHs(description: string): { code: string; label: string } | null {
  const d = description ?? '';
  for (const [re, code, label] of RULES) if (re.test(d)) return { code, label };
  return null;
}
