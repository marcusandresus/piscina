export type ChemicalUnit = "%";
export type SessionKind = "adjustment" | "check";
export type CheckMoment = "start-day" | "sun-hours" | "night";

export interface PoolConfig {
  id: string;
  updatedAt: string;
  pool: {
    diameterM: number;
    maxHeightCm?: number;
  };
  chlorineProduct: {
    type: string;
    concentration: number;
    unit: ChemicalUnit;
  };
  acidProduct: {
    concentration: number;
    unit: ChemicalUnit;
  };
  chemistry: {
    estimatedAlkalinityPpm: number;
  };
  targets: {
    phMin: number;
    phMax: number;
    chlorineMinPpm: number;
    chlorineMaxPpm: number;
  };
}

export interface Session {
  id: string;
  timestamp: string;
  kind?: SessionKind;
  checkMoment?: CheckMoment;
  waterHeightCm: number;
  measuredPh: number;
  measuredPhIntermediate?: number;
  measuredChlorinePpm: number;
  calculatedVolumeLiters: number;
  requiredPhCorrection: {
    totalMl: number;
    stage1Ml: number;
  };
  requiredChlorineDose: {
    maintenanceMl: number;
    correctiveMl: number;
  };
  appliedDoses: {
    phStage1Ml?: number;
    chlorineMl?: number;
  };
  postApplicationChecklist?: {
    pumpOn: boolean;
    dilutedCorrectly: boolean;
    perimeterApplication: boolean;
    waitRespected: boolean;
  };
  notes?: string;
}
