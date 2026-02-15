import type { PoolConfig } from "./types";

export const defaultPoolConfig: PoolConfig = {
  id: "default",
  updatedAt: new Date().toISOString(),
  pool: {
    diameterM: 3.05,
    maxHeightCm: 76
  },
  chlorineProduct: {
    type: "Hipoclorito de sodio",
    concentration: 5,
    unit: "%"
  },
  acidProduct: {
    concentration: 10,
    unit: "%"
  },
  chemistry: {
    estimatedAlkalinityPpm: 100,
    usesCover: false
  },
  targets: {
    phMin: 7.2,
    phMax: 7.6,
    chlorineMinPpm: 1,
    chlorineMaxPpm: 3
  }
};
