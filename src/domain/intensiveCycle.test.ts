import { describe, expect, it } from "vitest";
import {
  buildIntensiveSummary,
  buildOvernightPairs,
  evaluateIntensiveCycle,
  getIntensiveSessions
} from "./intensiveCycle";
import type { Session } from "./types";

function makeSession(
  id: string,
  timestamp: string,
  checkMoment: Session["checkMoment"],
  measuredChlorinePpm: number
): Session {
  return {
    id,
    timestamp,
    kind: "intensive-cycle",
    checkMoment,
    waterHeightCm: 70,
    measuredPh: 7.4,
    measuredChlorinePpm,
    calculatedVolumeLiters: 5000,
    requiredPhCorrection: { direction: "none", total: 0, stage1: 0, unit: "ml" },
    requiredChlorineDose: { maintenance: 0, corrective: 0, unit: "g" },
    appliedDoses: {}
  };
}

describe("getIntensiveSessions", () => {
  it("filtra por kind intensive-cycle y ordena por timestamp asc", () => {
    const sessions: Session[] = [
      makeSession("2", "2026-02-20T12:00:00.000Z", "night", 2.0),
      { ...makeSession("3", "2026-02-20T13:00:00.000Z", "start-day", 1.6), kind: "check" },
      makeSession("1", "2026-02-20T11:00:00.000Z", "start-day", 1.8)
    ];

    const intensive = getIntensiveSessions(sessions);
    expect(intensive.map((s) => s.id)).toEqual(["1", "2"]);
  });
});

describe("buildOvernightPairs", () => {
  it("genera pares night -> start-day consecutivos", () => {
    const sessions: Session[] = [
      makeSession("a", "2026-02-20T22:00:00.000Z", "night", 2.2),
      makeSession("b", "2026-02-21T08:00:00.000Z", "start-day", 1.4),
      makeSession("c", "2026-02-21T13:00:00.000Z", "sun-hours", 1.1),
      makeSession("d", "2026-02-21T22:00:00.000Z", "night", 2.0),
      makeSession("e", "2026-02-22T08:00:00.000Z", "start-day", 1.3)
    ];

    const pairs = buildOvernightPairs(sessions);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].loss).toBeCloseTo(0.8, 9);
    expect(pairs[0].morningChlorine).toBeCloseTo(1.4, 9);
    expect(pairs[1].loss).toBeCloseTo(0.7, 9);
    expect(pairs[1].morningChlorine).toBeCloseTo(1.3, 9);
  });
});

describe("evaluateIntensiveCycle", () => {
  it("permite cerrar cuando cumple noches, umbral y cloro AM en rango", () => {
    const sessions: Session[] = [
      makeSession("a", "2026-02-20T22:00:00.000Z", "night", 2.1),
      makeSession("b", "2026-02-21T08:00:00.000Z", "start-day", 1.4),
      makeSession("c", "2026-02-21T22:00:00.000Z", "night", 2.0),
      makeSession("d", "2026-02-22T08:00:00.000Z", "start-day", 1.3)
    ];

    const result = evaluateIntensiveCycle(sessions, 2, 1, 1, 3);
    expect(result.nightCount).toBe(2);
    expect(result.canClose).toBe(true);
  });

  it("bloquea cierre si alguna perdida nocturna supera umbral", () => {
    const sessions: Session[] = [
      makeSession("a", "2026-02-20T22:00:00.000Z", "night", 2.5),
      makeSession("b", "2026-02-21T08:00:00.000Z", "start-day", 1.0),
      makeSession("c", "2026-02-21T22:00:00.000Z", "night", 2.4),
      makeSession("d", "2026-02-22T08:00:00.000Z", "start-day", 0.9)
    ];

    const result = evaluateIntensiveCycle(sessions, 2, 1, 1, 3);
    expect(result.canClose).toBe(false);
  });
});

describe("buildIntensiveSummary", () => {
  it("resume promedio, ultima perdida y recomendacion", () => {
    const summary = buildIntensiveSummary({
      reason: "cambio a dicloro",
      minNights: 2,
      maxOvernightLossPpm: 1,
      overnightPairs: [
        { loss: 0.9, morningChlorine: 1.4 },
        { loss: 0.8, morningChlorine: 1.5 }
      ]
    });

    expect(summary.nightsEvaluated).toBe(2);
    expect(summary.avgOvernightLossPpm).toBeCloseTo(0.85, 9);
    expect(summary.lastOvernightLossPpm).toBeCloseTo(0.8, 9);
    expect(summary.recommendation).toContain("Patron estabilizado");
  });

  it("entrega recomendacion exigente cuando la perdida promedio supera umbral", () => {
    const summary = buildIntensiveSummary({
      reason: "cloro inestable",
      minNights: 2,
      maxOvernightLossPpm: 1,
      overnightPairs: [
        { loss: 1.3, morningChlorine: 1.1 },
        { loss: 1.4, morningChlorine: 1.0 }
      ]
    });

    expect(summary.avgOvernightLossPpm).toBeCloseTo(1.35, 9);
    expect(summary.recommendation).toContain("Patron aun exigente");
  });
});
