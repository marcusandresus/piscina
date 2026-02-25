import type { Session } from "./types";

export interface OvernightPair {
  loss: number;
  morningChlorine: number;
}

export interface IntensiveCycleEvaluation {
  nightCount: number;
  overnightPairs: OvernightPair[];
  lastPair: OvernightPair | null;
  canClose: boolean;
}

export interface IntensiveSummaryInput {
  reason: string;
  minNights: number;
  maxOvernightLossPpm: number;
  overnightPairs: OvernightPair[];
}

export interface IntensiveSummaryResult {
  nightsEvaluated: number;
  avgOvernightLossPpm: number;
  lastOvernightLossPpm: number;
  recommendation: string;
}

export function getIntensiveSessions(sessions: Session[]): Session[] {
  return sessions
    .filter((session) => session.kind === "intensive-cycle")
    .slice()
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export function buildOvernightPairs(sessions: Session[]): OvernightPair[] {
  const pairs: OvernightPair[] = [];

  for (let index = 1; index < sessions.length; index += 1) {
    const previous = sessions[index - 1];
    const current = sessions[index];
    if (previous.checkMoment === "night" && current.checkMoment === "start-day") {
      pairs.push({
        loss: previous.measuredChlorinePpm - current.measuredChlorinePpm,
        morningChlorine: current.measuredChlorinePpm
      });
    }
  }

  return pairs;
}

export function evaluateIntensiveCycle(
  sessions: Session[],
  minNights: number,
  maxOvernightLossPpm: number,
  chlorineMinPpm: number,
  chlorineMaxPpm: number
): IntensiveCycleEvaluation {
  const overnightPairs = buildOvernightPairs(sessions);
  const nightCount = sessions.filter((session) => session.checkMoment === "night").length;
  const lastPair = overnightPairs.length > 0 ? overnightPairs[overnightPairs.length - 1] : null;
  const recentPairs = overnightPairs.slice(-minNights);
  const hasEnoughPairs = recentPairs.length >= minNights;
  const stableLoss =
    hasEnoughPairs && recentPairs.every((pair) => pair.loss >= 0 && pair.loss <= maxOvernightLossPpm);
  const morningsInRange =
    hasEnoughPairs &&
    recentPairs.every(
      (pair) => pair.morningChlorine >= chlorineMinPpm && pair.morningChlorine <= chlorineMaxPpm
    );

  return {
    nightCount,
    overnightPairs,
    lastPair,
    canClose: hasEnoughPairs && stableLoss && morningsInRange
  };
}

export function buildIntensiveSummary(input: IntensiveSummaryInput): IntensiveSummaryResult {
  const nightsEvaluated = Math.min(input.minNights, input.overnightPairs.length);
  const evaluatedPairs = input.overnightPairs.slice(-nightsEvaluated);
  const avgOvernightLossPpm =
    evaluatedPairs.reduce((sum, pair) => sum + pair.loss, 0) / evaluatedPairs.length;
  const lastOvernightLossPpm =
    evaluatedPairs[evaluatedPairs.length - 1]?.loss ?? avgOvernightLossPpm;
  const recommendation =
    avgOvernightLossPpm <= input.maxOvernightLossPpm
      ? "Patron estabilizado. Volver al flujo diario con dosis correctiva solo cuando el cloro caiga bajo objetivo."
      : "Patron aun exigente. Mantener monitoreo diario y considerar extender ciclo 1 noche adicional.";

  return {
    nightsEvaluated,
    avgOvernightLossPpm,
    lastOvernightLossPpm,
    recommendation
  };
}
