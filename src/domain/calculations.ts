import type { PoolConfig } from "./types";

const PH_NEUTRAL_MIN = 7.2;
const PH_NEUTRAL_MAX = 7.6;
const REFERENCE_MURIATIC_ACID_PCT = 31.45;
const PH_DOSE_ML_PER_01_10K_AT_31_PCT = 25;
const CHLORINE_MG_PER_PPM_L = 1;

export function calculateVolumeLiters(diameterM: number, waterHeightCm: number): number {
  const radius = diameterM / 2;
  const heightM = waterHeightCm / 100;
  const volumeM3 = Math.PI * radius * radius * heightM;
  return volumeM3 * 1000;
}

export function calculatePhCorrectionMl(
  measuredPh: number,
  volumeLiters: number,
  acidConcentrationPct: number,
  targetPhMax: number,
  estimatedAlkalinityPpm: number
): number {
  if (measuredPh <= targetPhMax || acidConcentrationPct <= 0) {
    return 0;
  }

  const delta = measuredPh - targetPhMax;
  const steps = delta / 0.1;
  const volumeFactor = volumeLiters / 10000;
  const concentrationFactor = REFERENCE_MURIATIC_ACID_PCT / acidConcentrationPct;
  const alkalinityFactor = Math.max(0.4, estimatedAlkalinityPpm / 100);
  const mlPerStepForConcentration = PH_DOSE_ML_PER_01_10K_AT_31_PCT * concentrationFactor;
  return Math.max(0, steps * mlPerStepForConcentration * volumeFactor * alkalinityFactor);
}

export function calculateChlorineDoseMl(
  measuredChlorinePpm: number,
  volumeLiters: number,
  chlorineConcentrationPct: number,
  targetMinPpm: number,
  targetMaxPpm: number
): { maintenanceMl: number; correctiveMl: number } {
  if (chlorineConcentrationPct <= 0) {
    return { maintenanceMl: 0, correctiveMl: 0 };
  }

  const targetMidPpm = (targetMinPpm + targetMaxPpm) / 2;
  const deficitToMinPpm = Math.max(0, targetMinPpm - measuredChlorinePpm);
  const deficitToMidPpm = Math.max(0, targetMidPpm - measuredChlorinePpm);
  const mgNeededToMin = deficitToMinPpm * CHLORINE_MG_PER_PPM_L * volumeLiters;
  const mgNeededToMid = deficitToMidPpm * CHLORINE_MG_PER_PPM_L * volumeLiters;
  const mgPerMl = chlorineConcentrationPct * 10;
  const maintenanceMl = mgNeededToMin / mgPerMl;
  const correctiveMl = mgNeededToMid / mgPerMl;

  return { maintenanceMl, correctiveMl };
}

export function classifyPh(measuredPh: number, config: PoolConfig): "ok" | "leve" | "ajuste" {
  if (measuredPh >= config.targets.phMin && measuredPh <= config.targets.phMax) {
    return "ok";
  }
  if (
    measuredPh >= config.targets.phMin - 0.2 &&
    measuredPh <= config.targets.phMax + 0.2
  ) {
    return "leve";
  }
  return "ajuste";
}

export function classifyChlorine(
  measuredChlorinePpm: number,
  config: PoolConfig
): "ok" | "leve" | "ajuste" {
  if (
    measuredChlorinePpm >= config.targets.chlorineMinPpm &&
    measuredChlorinePpm <= config.targets.chlorineMaxPpm
  ) {
    return "ok";
  }
  if (
    measuredChlorinePpm >= config.targets.chlorineMinPpm - 0.5 &&
    measuredChlorinePpm <= config.targets.chlorineMaxPpm + 0.5
  ) {
    return "leve";
  }
  return "ajuste";
}

export function toFixedNumber(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

export function isPhInRange(value: number): boolean {
  return value >= 6.8 && value <= 8.2;
}

export function isChlorineInRange(value: number): boolean {
  return value >= 0 && value <= 10;
}

export function isHeightInRange(value: number, maxHeightCm?: number): boolean {
  if (value <= 0) {
    return false;
  }

  if (typeof maxHeightCm === "number") {
    return value <= maxHeightCm;
  }

  return value <= 200;
}

export function getStatusLabel(value: "ok" | "leve" | "ajuste"): string {
  if (value === "ok") {
    return "OK";
  }
  if (value === "leve") {
    return "Ajuste leve";
  }
  return "Ajuste requerido";
}

export function isPhNeutralBand(value: number): boolean {
  return value >= PH_NEUTRAL_MIN && value <= PH_NEUTRAL_MAX;
}
