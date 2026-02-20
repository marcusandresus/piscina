import type { DoseUnit, PoolConfig, ProductPresentation } from "./types";

const PH_NEUTRAL_MIN = 7.2;
const PH_NEUTRAL_MAX = 7.6;
const REFERENCE_MURIATIC_ACID_PCT = 31.45;
const PH_DOSE_ML_PER_01_10K_AT_31_PCT = 25;
const CHLORINE_MG_PER_PPM_L = 1;
const PH_UP_REFERENCE_G_PER_01_10K = 18;

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
  const mlPerStep = calculatePhMlPerStep(
    volumeLiters,
    acidConcentrationPct,
    estimatedAlkalinityPpm
  );
  return Math.max(0, steps * mlPerStep);
}

export function calculatePhMlPerStep(
  volumeLiters: number,
  acidConcentrationPct: number,
  estimatedAlkalinityPpm: number
): number {
  if (acidConcentrationPct <= 0) {
    return 0;
  }

  const volumeFactor = volumeLiters / 10000;
  const concentrationFactor = REFERENCE_MURIATIC_ACID_PCT / acidConcentrationPct;
  const alkalinityFactor = Math.max(0.4, estimatedAlkalinityPpm / 100);
  const mlPerStepForConcentration = PH_DOSE_ML_PER_01_10K_AT_31_PCT * concentrationFactor;
  return Math.max(0, mlPerStepForConcentration * volumeFactor * alkalinityFactor);
}

export function estimatePhAfterAcidDose(
  measuredPh: number,
  acidDoseMl: number,
  volumeLiters: number,
  acidConcentrationPct: number,
  estimatedAlkalinityPpm: number
): number {
  const mlPerStep = calculatePhMlPerStep(
    volumeLiters,
    acidConcentrationPct,
    estimatedAlkalinityPpm
  );
  if (mlPerStep <= 0 || acidDoseMl <= 0) {
    return measuredPh;
  }

  const phDrop = (acidDoseMl / mlPerStep) * 0.1;
  return measuredPh - phDrop;
}

interface ChlorineDoseResult {
  maintenance: number;
  corrective: number;
  unit: DoseUnit;
}

export function calculateChlorineDose(
  measuredChlorinePpm: number,
  volumeLiters: number,
  chlorineConcentrationPct: number,
  presentation: ProductPresentation,
  targetMinPpm: number,
  targetMaxPpm: number
): ChlorineDoseResult {
  const unit: DoseUnit = presentation === "granular-g" ? "g" : "ml";
  if (chlorineConcentrationPct <= 0) {
    return { maintenance: 0, corrective: 0, unit };
  }

  const targetMidPpm = (targetMinPpm + targetMaxPpm) / 2;
  const deficitToMinPpm = Math.max(0, targetMinPpm - measuredChlorinePpm);
  const deficitToMidPpm = Math.max(0, targetMidPpm - measuredChlorinePpm);
  const mgNeededToMin = deficitToMinPpm * CHLORINE_MG_PER_PPM_L * volumeLiters;
  const mgNeededToMid = deficitToMidPpm * CHLORINE_MG_PER_PPM_L * volumeLiters;
  const mgPerMl = chlorineConcentrationPct * 10;
  const maintenanceMl = mgNeededToMin / mgPerMl;
  const correctiveMl = mgNeededToMid / mgPerMl;

  return { maintenance: maintenanceMl, corrective: correctiveMl, unit };
}

export function calculateChlorineDoseMl(
  measuredChlorinePpm: number,
  volumeLiters: number,
  chlorineConcentrationPct: number,
  targetMinPpm: number,
  targetMaxPpm: number
): { maintenanceMl: number; correctiveMl: number } {
  const result = calculateChlorineDose(
    measuredChlorinePpm,
    volumeLiters,
    chlorineConcentrationPct,
    "liquid-ml",
    targetMinPpm,
    targetMaxPpm
  );
  return { maintenanceMl: result.maintenance, correctiveMl: result.corrective };
}

export function calculatePhRaiseDose(
  measuredPh: number,
  volumeLiters: number,
  productConcentrationPct: number,
  targetPhMin: number,
  referenceDoseGPerPointPer10k: number = PH_UP_REFERENCE_G_PER_01_10K
): number {
  if (measuredPh >= targetPhMin || productConcentrationPct <= 0 || referenceDoseGPerPointPer10k <= 0) {
    return 0;
  }

  const delta = targetPhMin - measuredPh;
  const steps = delta / 0.1;
  const volumeFactor = volumeLiters / 10000;
  const concentrationFactor = 100 / productConcentrationPct;
  return Math.max(0, steps * referenceDoseGPerPointPer10k * volumeFactor * concentrationFactor);
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
