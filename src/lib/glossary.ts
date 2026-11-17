/**
 * Lexique affiché par les boutons « i » de l'application.
 * Chaque entrée : un titre et une explication courte, avec un exemple concret.
 */
export interface GlossaryEntry {
  title: string;
  text: string;
  example?: string;
}

export const GLOSSARY = {
  proposals: {
    title: 'Deux propositions',
    text: "« Selon Grundfos » reprend uniquement ce que Grundfos a réellement fait dans vos PL : l'emballage le plus utilisé pour chaque article, et pour un reliquat un vrai colis Grundfos assez grand, sans recalcul ni regroupement. « Optimisée » applique l'intelligence de l'application : choix du meilleur emballage selon la quantité, palettes incomplètes recalculées, petits articles regroupés. Comparez puis choisissez celle à exporter.",
    example: '1 CR10-10 en reliquat : Grundfos → palette réelle 120 × 80 × 85 ; optimisée → palette recalculée 120 × 80 × 37.',
  },
  reliability: {
    title: 'Fiabilité de la proposition',
    text: "Pour chaque article, l'application indique sur quoi repose le colisage proposé : un envoi réel identique, un calcul entre deux envois réels, une estimation, ou vos propres mesures. Plus la donnée est proche d'un envoi réel, plus le résultat est sûr.",
  },
  observed: {
    title: 'Déjà expédié',
    text: "Cette quantité a déjà été expédiée exactement ainsi dans une de vos Packing Lists : l'application reprend le même emballage, les mêmes dimensions et le même poids. C'est le niveau le plus fiable.",
    example: '10 SP5A-25 → palette à plateau 120 × 80 × 50 cm, 241 kg, comme dans la PL 35215061.',
  },
  interpolated: {
    title: 'Interpolé',
    text: "La quantité demandée se situe entre deux envois réels du même article sur le même type de palette. L'application calcule la hauteur et le poids « entre les deux », proportionnellement. C'est fiable : le résultat est encadré par deux cas réels.",
    example: 'SP3A-33 : 4 unités = 26 cm, 10 unités = 38 cm. Pour 5 unités → environ 28 cm.',
  },
  estimated: {
    title: 'Estimé (extrapolé)',
    text: "On ne connaît qu'un seul envoi de l'article, avec une quantité différente. L'application en déduit le résultat à partir de règles observées sur vos PL : jusqu'à 50 cm de chargement, une seule couche (la hauteur ne baisse pas) ; au-delà, la hauteur diminue avec la quantité. Moins sûr : vérifiez si possible.",
    example: 'Palette de 25 pompes connue (100 cm) → 5 pompes estimées à 32 cm.',
  },
  mixed: {
    title: 'Colis mixte',
    text: "L'article n'a été vu que dans des colis contenant aussi d'autres articles. Son poids et son volume ont été répartis au prorata des quantités : ce sont des approximations. Saisissez ses vraies dimensions si vous les connaissez.",
  },
  manual: {
    title: 'Fiche manuelle',
    text: "Les dimensions et poids de cet article ont été saisis ou corrigés à la main. Ils sont prioritaires sur tout ce que l'application a déduit des PL importées (ces données restent consultables dans la fiche article).",
  },
  unknown: {
    title: 'Introuvable dans la base',
    text: "Aucun article de la base ne correspond à ce code ou PN. Il apparaît sur la PL sans poids ni colis. Touchez « Saisir dimensions et poids » pour le créer ; il sera retenu pour les prochaines fois.",
  },
  consolidate: {
    title: 'Regrouper les petits articles',
    text: "Les colis de moins de 0,15 m³ et 60 kg sont réunis dans un carton standard (40 × 30 × 30, 60 × 40 × 40 ou 80 × 60 × 50) ou sur une palette commune, comme le ferait un emballeur. Moins de colis à manipuler et un volume plus réaliste. Les gros colis gardent leur emballage d'origine.",
  },
  partial: {
    title: 'Colis incomplet',
    text: "Le dernier colis n'est pas plein : par exemple 7 pompes avec 6 par palette donnent une palette pleine et une palette d'une pompe. Sa hauteur est recalculée, mais le poids de l'emballage (palette vide, environ 25 kg pour une 120 × 80) reste entier.",
  },
  grouped: {
    title: 'Colis groupé',
    text: "Carton ou palette créé par l'application pour réunir plusieurs petits articles. Ses dimensions sont calculées à partir du volume des articles avec un taux de remplissage de 75 %, et son poids inclut l'emballage (environ 10 kg pour une demi-palette, 25 kg pour une palette).",
  },
  netGross: {
    title: 'Poids net / poids brut',
    text: "Net : le poids de la marchandise seule. Brut : marchandise + emballage (palette, caisse, carton, film). C'est le brut qui compte pour le transport et la manutention.",
  },
  volume: {
    title: 'Volume',
    text: 'Volume extérieur du colis : longueur × largeur × hauteur. 1 m³ = 100 × 100 × 100 cm. Une palette 120 × 80 × 100 cm fait 0,96 m³.',
  },
  airChargeable: {
    title: 'Poids taxable aérien',
    text: "Les compagnies aériennes facturent le plus élevé entre le poids réel et le poids volumétrique (1 m³ = 167 kg). Un colis léger mais encombrant coûte donc comme s'il était lourd.",
    example: '2 m³ pesant 150 kg → taxé 334 kg.',
  },
  roadChargeable: {
    title: 'Poids taxable routier / express',
    text: 'Même principe que l’aérien avec un autre facteur : 1 m³ = 333 kg (usuel en messagerie et express). À confirmer avec votre transporteur.',
  },
  revenueTon: {
    title: 'Unités payantes (UP) maritimes',
    text: "En groupage maritime (LCL), on paie à l'« unité payante » : le plus grand entre le poids en tonnes et le volume en m³. 1 UP = 1 tonne ou 1 m³.",
    example: '3,2 m³ pesant 1,1 t → 3,2 UP.',
  },
  containerFill: {
    title: 'Occupation des conteneurs',
    text: "Pour chaque conteneur, l'application retient la contrainte la plus forte : volume, charge utile (poids maximal), ou surface au sol si les colis ne sont pas empilés. Au-delà de 100 %, un seul conteneur ne suffit pas.",
  },
  loadPlan: {
    title: 'Plan de chargement',
    text: "Vue de dessus du véhicule : chaque rectangle est un colis, numéroté comme sur la PL. Les colis sont posés au sol sans être empilés (hypothèse prudente), les plus lourds vers le fond. L'application essaie plusieurs rangements et garde celui qui demande le moins de véhicules et équilibre le mieux la charge.",
  },
  vehicle: {
    title: 'Transport proposé',
    text: "Le plus petit moyen de transport dans lequel tous les colis tiennent au sol, en respectant la hauteur de porte (228 cm pour un conteneur standard, 258 cm pour un High Cube) et la charge utile. Vous pouvez imposer un autre véhicule avec les boutons au-dessus.",
  },
  ldm: {
    title: 'Mètres de plancher (LDM)',
    text: "Unité de facturation du transport routier : la longueur de remorque occupée, sur toute sa largeur (2,40 m environ). Un camion complet fait 13,6 LDM. Une palette 120 × 80 posée en long ≈ 0,4 LDM.",
  },
  floorUsed: {
    title: 'Plancher occupé',
    text: 'Part de la surface au sol du véhicule couverte par les colis. Un taux bas avec une grande longueur utilisée signale des colis de formes difficiles à combiner.',
  },
  cog: {
    title: 'Centre de gravité',
    text: "Point d'équilibre de la charge (point rouge sur le plan). Il doit rester proche du milieu de la largeur pour éviter que le conteneur ou la remorque penche, et pas trop en avant ou en arrière. Si l'application signale un décentrage, calez et sanglez les colis.",
  },
  scaleView: {
    title: 'Vue à la même échelle',
    text: 'Tous les colis vus de face avec la même échelle, à côté d’une silhouette de 1,80 m : on compare d’un coup d’œil leurs tailles réelles.',
  },
  variants: {
    title: 'Emballages observés',
    text: "Toutes les façons dont cet article a été emballé dans vos PL (par exemple 4 ou 6 pompes par palette). À la génération, l'application choisit la plus adaptée à la quantité : d'abord un envoi identique s'il existe, sinon le moins de colis possible.",
  },
  toCheck: {
    title: 'À vérifier',
    text: 'Articles dont les données sont incomplètes ou approximatives : vus seulement en colis mixte, sans dimensions ou sans poids. Corrigez-les en priorité, surtout ceux que vous expédiez souvent.',
  },
  unitPacked: {
    title: "Une unité emballée",
    text: "Mesurez l'article tel qu'il part chez le client, avec son emballage individuel (carton, caisse…), pas l'article nu. Le poids brut inclut cet emballage.",
  },
  weightBasis: {
    title: 'Les poids indiqués sont…',
    text: "Dans un PL, le poids d'une ligne peut être le total de la ligne (cas le plus courant), le poids d'une unité, ou le poids d'un colis. Choisissez ce qui correspond au fichier importé pour que l'application calcule correctement le poids unitaire.",
  },
  mapping: {
    title: 'Association des colonnes',
    text: "L'application reconnaît automatiquement les colonnes (code, quantité, dimensions…). Si une colonne est mal reconnue, choisissez-la dans la liste : l'aperçu en dessous se met à jour.",
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;
