import type { PoolConfig } from "./types";

export const defaultPoolConfig: PoolConfig = {
  id: "default",
  updatedAt: new Date().toISOString(),
  pool: {
    diameterM: 3.05,
    maxHeightCm: 76
  },
  chlorineProduct: {
    type: "Dicloroisocianurato de sodio",
    concentration: 56,
    unit: "%",
    presentation: "granular-g"
  },
  acidProduct: {
    type: "Acido muriatico (HCl)",
    concentration: 10,
    unit: "%"
  },
  phUpProduct: {
    enabled: true,
    type: "Carbonato de sodio (pH+)",
    concentration: 100,
    unit: "%",
    presentation: "granular-g",
    referenceDoseGPerPointPer10kL: 18
  },
  chemistry: {
    estimatedAlkalinityPpm: 100,
    usesCover: false
  },
  workflow: {
    defaultWaitMinutes: 45,
    maxWaitMinutes: 60,
    enableIntensiveCycle: false,
    intensiveMinNights: 2,
    intensiveMaxOvernightLossPpm: 1
  },
  targets: {
    phMin: 7.2,
    phMax: 7.6,
    chlorineMinPpm: 1,
    chlorineMaxPpm: 3
  }
};
