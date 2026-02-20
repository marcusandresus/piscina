export type ChemicalUnit = "%";
export type ProductPresentation = "liquid-ml" | "granular-g";
export type DoseUnit = "ml" | "g";
export type SessionKind = "adjustment" | "check" | "intensive-cycle";
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
    presentation: ProductPresentation;
  };
  acidProduct: {
    type: string;
    concentration: number;
    unit: ChemicalUnit;
  };
  phUpProduct: {
    enabled: boolean;
    type: string;
    concentration: number;
    unit: ChemicalUnit;
    presentation: "granular-g";
    referenceDoseGPerPointPer10kL: number;
  };
  chemistry: {
    estimatedAlkalinityPpm: number;
    usesCover: boolean;
  };
  workflow: {
    defaultWaitMinutes: number;
    maxWaitMinutes: number;
    enableIntensiveCycle: boolean;
    intensiveMinNights: number;
    intensiveMaxOvernightLossPpm: number;
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
    direction: "down" | "up" | "none";
    total: number;
    stage1: number;
    unit: DoseUnit;
  };
  requiredChlorineDose: {
    maintenance: number;
    corrective: number;
    unit: DoseUnit;
  };
  appliedDoses: {
    phStage1?: number;
    phUnit?: DoseUnit;
    chlorine?: number;
    chlorineUnit?: DoseUnit;
  };
  postApplicationChecklist?: {
    pumpOn: boolean;
    dilutedCorrectly: boolean;
    perimeterApplication: boolean;
    waitRespected: boolean;
  };
  notes?: string;
}
