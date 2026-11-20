import type { FreightRates, PackingList } from '../types';
import { planLoad } from './loadPlan';
import { round } from './parseValues';

/**
 * Indicateurs de fret calculés à partir du colisage.
 * Facteurs volumétriques usuels (à confirmer avec le transitaire) :
 * - aérien : 1 m³ = 167 kg (IATA, 6000 cm³/kg)
 * - routier / express : 1 m³ = 333 kg
 * - maritime groupage (LCL) : unité payante = max(poids en tonnes, volume en m³)
 */
export interface FreightInfo {
  airChargeableKg: number;
  roadChargeableKg: number;
  seaRevenueTon: number; // W/M
  /** occupation estimée des conteneurs */
  containers: { name: string; volumePct: number; weightPct: number; floorPct: number }[];
  heaviest: number;
  longest: number;
  tallest: number;
  /** alertes de manutention */
  alerts: string[];
}

const CONTAINERS = [
  { name: "20' Dry", volume: 33.2, payload: 28200, floor: 589 * 235, door: 228 },
  { name: "40' Dry", volume: 67.7, payload: 26700, floor: 1203 * 235, door: 228 },
  { name: "40' High Cube", volume: 76.4, payload: 26500, floor: 1203 * 235, door: 258 },
];

export function freightInfo(pl: PackingList): FreightInfo {
  const vol = pl.totals.volume;
  const kg = pl.totals.grossWeight;
  const floor = pl.packages.reduce((s, p) => s + p.length * p.width, 0); // cm², colis non gerbés
  const alerts: string[] = [];
  const heaviest = Math.max(0, ...pl.packages.map((p) => p.grossWeight));
  const longest = Math.max(0, ...pl.packages.map((p) => Math.max(p.length, p.width)));
  const tallest = Math.max(0, ...pl.packages.map((p) => p.height));
  if (heaviest > 1000) alerts.push(`Colis de ${Math.round(heaviest)} kg : chariot élévateur requis (vérifiez sa capacité)`);
  else if (heaviest > 25) alerts.push(`Colis de plus de 25 kg : manutention mécanique recommandée`);
  if (tallest > 228) alerts.push(`Colis de ${tallest} cm de haut : dépasse la porte d'un conteneur standard (228 cm) — High Cube ou Open Top`);
  else if (tallest > 160) alerts.push(`Colis de ${tallest} cm de haut : trop haut pour la soute d'un avion passagers (≈ 160 cm max) — avion cargo nécessaire en aérien`);
  if (longest > 1203) alerts.push(`Colis de ${longest} cm de long : ne rentre pas dans un 40'`);
  else if (longest > 589) alerts.push(`Colis de ${longest} cm de long : nécessite un 40'`);
  return {
    airChargeableKg: round(Math.max(kg, vol * 167), 1),
    roadChargeableKg: round(Math.max(kg, vol * 333), 1),
    seaRevenueTon: round(Math.max(kg / 1000, vol), 3),
    containers: CONTAINERS.map((c) => ({
      name: c.name,
      volumePct: round((vol / c.volume) * 100, 1),
      weightPct: round((kg / c.payload) * 100, 1),
      floorPct: round((floor / c.floor) * 100, 1),
    })),
    heaviest,
    longest,
    tallest,
    alerts,
  };
}

/* ------------------------------------------------------------------ */
/* Estimation du coût du transport                                     */
/* ------------------------------------------------------------------ */

/** Tarifs indicatifs (à remplacer par ceux de votre transitaire) */
export const DEFAULT_RATES: FreightRates = {
  currency: 'EUR',
  airPerKg: 4.5,
  airMin: 150,
  lclPerUp: 85,
  lclMin: 150,
  container: { '10': 1800, '20': 2200, '40': 3500, '40hc': 3700 },
  courierPerKg: 0.9,
  courierMin: 45,
  truck: { mini: 250, van12: 350, box20: 450, p12: 700, porteur: 850, semi: 1300 },
};

export interface FreightOption {
  id: string;
  mode: 'sea' | 'road' | 'air';
  label: string;
  detail: string;
  cost: number;
  /** solution impossible (colis trop long, trop lourd…) */
  impossible?: string;
}

export function freightOptions(pl: PackingList, rates: FreightRates = DEFAULT_RATES): FreightOption[] {
  const f = freightInfo(pl);
  const out: FreightOption[] = [];
  const n0 = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
  const n2 = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  out.push({
    id: 'air',
    mode: 'air',
    label: 'Aérien',
    detail: `${n0(f.airChargeableKg)} kg taxables × ${n2(rates.airPerKg)}`,
    cost: Math.max(rates.airMin, f.airChargeableKg * rates.airPerKg),
    impossible: f.tallest > 300 ? `colis de ${f.tallest} cm de haut` : undefined,
  });
  out.push({
    id: 'lcl',
    mode: 'sea',
    label: 'Maritime groupage (LCL)',
    detail: `${n2(f.seaRevenueTon)} UP × ${n2(rates.lclPerUp)}`,
    cost: Math.max(rates.lclMin, f.seaRevenueTon * rates.lclPerUp),
  });
  const sea = planLoad(pl.packages, 'auto', 'sea');
  if (sea && sea.bins.length && !sea.unplaced.length) {
    const cost = sea.bins.reduce((s, b) => s + (rates.container[b.vehicle.id] ?? 0), 0);
    if (cost > 0) out.push({ id: 'fcl', mode: 'sea', label: 'Maritime conteneur complet (FCL)', detail: sea.summary, cost });
  }
  // messagerie : jusqu'à 3 t environ
  if (pl.totals.grossWeight <= 3000)
    out.push({
      id: 'courier',
      mode: 'road',
      label: 'Messagerie (routier groupé)',
      detail: `${n0(f.roadChargeableKg)} kg taxables × ${n2(rates.courierPerKg)}`,
      cost: Math.max(rates.courierMin, f.roadChargeableKg * rates.courierPerKg),
      impossible: f.heaviest > 1000 ? `colis de ${n0(f.heaviest)} kg` : undefined,
    });
  const road = planLoad(pl.packages, 'auto', 'road');
  if (road && road.bins.length && !road.unplaced.length) {
    const cost = road.bins.reduce((s, b) => s + (rates.truck[b.vehicle.id] ?? 0), 0);
    if (cost > 0) out.push({ id: 'truck', mode: 'road', label: 'Camion dédié', detail: road.summary, cost });
  }
  return out.map((o) => ({ ...o, cost: Math.round(o.cost) })).sort((a, b) => Number(!!a.impossible) - Number(!!b.impossible) || a.cost - b.cost);
}
