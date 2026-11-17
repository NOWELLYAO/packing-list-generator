import type { PackingList } from '../types';
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
