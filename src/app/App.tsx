import { useEffect, useMemo, useState } from "react";
import { configRepo } from "../data/repositories/configRepo";
import { sessionRepo } from "../data/repositories/sessionRepo";
import {
  calculateChlorineDose,
  calculatePhCorrectionMl,
  calculatePhRaiseDose,
  calculateVolumeLiters,
  classifyChlorine,
  classifyPh,
  getStatusLabel,
  isChlorineInRange,
  isHeightInRange,
  isPhInRange,
  toFixedNumber
} from "../domain/calculations";
import { defaultPoolConfig } from "../domain/defaults";
import type { CheckMoment, DoseUnit, PoolConfig, Session } from "../domain/types";
import "./App.css";

type Screen = "home" | "measure" | "plan" | "history" | "settings" | "help" | "intensive-cycle";
type MeasureMode = "plan" | "measure-only";

interface MeasureDraft {
  mode: MeasureMode;
  waterHeightCm: number | null;
  measuredPh: number | null;
  measuredChlorinePpm: number | null;
  checkMoment: CheckMoment;
  notes: string;
  waitMinutes: number;
  forIntensiveCycle: boolean;
}

interface ActionPlan {
  volumeLitersRaw: number;
  volumeLiters: number;
  phStatus: "ok" | "leve" | "ajuste";
  chlorineStatus: "ok" | "leve" | "ajuste";
  phDirection: "down" | "up" | "none";
  phTotal: number;
  phStage1: number;
  phUnit: DoseUnit;
  chlorineMaintenance: number;
  chlorineCorrective: number;
  chlorineUnit: DoseUnit;
}

const WAIT_OPTIONS = [15, 30, 45, 60];
const INTENSIVE_STATE_KEY = "piscina-intensive-cycle-v1";
const INTENSIVE_SUMMARY_KEY = "piscina-intensive-summary-v1";

interface IntensiveCycleState {
  active: boolean;
  reason: string;
  startedAtIso: string | null;
}

interface IntensiveCycleSummary {
  closedAtIso: string;
  reason: string;
  nightsEvaluated: number;
  avgOvernightLossPpm: number;
  lastOvernightLossPpm: number;
  recommendation: string;
}

function createDefaultIntensiveCycleState(): IntensiveCycleState {
  return {
    active: false,
    reason: "",
    startedAtIso: null
  };
}

function createDraft(config: PoolConfig | null): MeasureDraft {
  return {
    mode: "plan",
    waterHeightCm: config?.pool.maxHeightCm ?? null,
    measuredPh: null,
    measuredChlorinePpm: null,
    checkMoment: "start-day",
    notes: "",
    waitMinutes: config?.workflow.defaultWaitMinutes ?? 45,
    forIntensiveCycle: false
  };
}

function getMeasureModeLabel(mode: MeasureMode): string {
  return mode === "measure-only" ? "Medicion fuera de ciclo" : "Medicion + plan de accion";
}

function normalizeConfig(loaded: PoolConfig | undefined): PoolConfig {
  if (!loaded) {
    return defaultPoolConfig;
  }

  return {
    ...defaultPoolConfig,
    ...loaded,
    pool: {
      ...defaultPoolConfig.pool,
      ...loaded.pool
    },
    chlorineProduct: {
      ...defaultPoolConfig.chlorineProduct,
      ...loaded.chlorineProduct
    },
    acidProduct: {
      ...defaultPoolConfig.acidProduct,
      ...loaded.acidProduct
    },
    phUpProduct: {
      ...defaultPoolConfig.phUpProduct,
      ...loaded.phUpProduct
    },
    chemistry: {
      ...defaultPoolConfig.chemistry,
      ...loaded.chemistry
    },
    workflow: {
      ...defaultPoolConfig.workflow,
      ...loaded.workflow
    },
    targets: {
      ...defaultPoolConfig.targets,
      ...loaded.targets
    }
  };
}

function canComputePlan(draft: MeasureDraft, config: PoolConfig): boolean {
  return (
    draft.waterHeightCm !== null &&
    draft.measuredPh !== null &&
    draft.measuredChlorinePpm !== null &&
    isHeightInRange(draft.waterHeightCm, config.pool.maxHeightCm) &&
    isPhInRange(draft.measuredPh) &&
    isChlorineInRange(draft.measuredChlorinePpm)
  );
}

function getPhRecommendation(
  measuredPh: number,
  volumeLitersRaw: number,
  config: PoolConfig
): { direction: "down" | "up" | "none"; total: number; stage1: number; unit: DoseUnit } {
  if (measuredPh > config.targets.phMax) {
    const total = calculatePhCorrectionMl(
      measuredPh,
      volumeLitersRaw,
      config.acidProduct.concentration,
      config.targets.phMax,
      config.chemistry.estimatedAlkalinityPpm
    );
    return {
      direction: "down",
      total,
      stage1: total * 0.5,
      unit: "ml"
    };
  }

  if (measuredPh < config.targets.phMin && config.phUpProduct.enabled) {
    const total = calculatePhRaiseDose(
      measuredPh,
      volumeLitersRaw,
      config.phUpProduct.concentration,
      config.targets.phMin,
      config.phUpProduct.referenceDoseGPerPointPer10kL
    );
    return {
      direction: "up",
      total,
      stage1: total * 0.5,
      unit: "g"
    };
  }

  return {
    direction: "none",
    total: 0,
    stage1: 0,
    unit: "ml"
  };
}

function statusTone(value: "ok" | "leve" | "ajuste"): string {
  if (value === "ok") {
    return "status-ok";
  }
  if (value === "leve") {
    return "status-warn";
  }
  return "status-danger";
}

function getLegacyPhTotal(session: Session): number {
  const legacy = session.requiredPhCorrection as unknown as { totalMl?: number; total?: number };
  return typeof legacy.total === "number" ? legacy.total : legacy.totalMl ?? 0;
}

function getLegacyPhStage1(session: Session): number {
  const legacy = session.requiredPhCorrection as unknown as { stage1Ml?: number; stage1?: number };
  return typeof legacy.stage1 === "number" ? legacy.stage1 : legacy.stage1Ml ?? 0;
}

function getLegacyChlorineMaintenance(session: Session): number {
  const legacy = session.requiredChlorineDose as unknown as {
    maintenanceMl?: number;
    maintenance?: number;
  };
  return typeof legacy.maintenance === "number" ? legacy.maintenance : legacy.maintenanceMl ?? 0;
}

function getLegacyChlorineCorrective(session: Session): number {
  const legacy = session.requiredChlorineDose as unknown as {
    correctiveMl?: number;
    corrective?: number;
  };
  return typeof legacy.corrective === "number" ? legacy.corrective : legacy.correctiveMl ?? 0;
}

export function App() {
  const [config, setConfig] = useState<PoolConfig | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<PoolConfig | null>(null);
  const [draft, setDraft] = useState<MeasureDraft>(() => createDraft(null));
  const [screen, setScreen] = useState<Screen>("home");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intensiveCycle, setIntensiveCycle] = useState<IntensiveCycleState>(
    createDefaultIntensiveCycleState
  );
  const [intensiveReasonDraft, setIntensiveReasonDraft] = useState("cambio a dicloro");
  const [intensiveSummary, setIntensiveSummary] = useState<IntensiveCycleSummary | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const loaded = await configRepo.load();
        const nextConfig = normalizeConfig(loaded);
        if (!loaded) {
          await configRepo.save(nextConfig);
        }

        const loadedSessions = await sessionRepo.list();
        setConfig(nextConfig);
        setSettingsDraft(nextConfig);
        setDraft(createDraft(nextConfig));
        setSessions(loadedSessions);

        try {
          const rawIntensive = localStorage.getItem(INTENSIVE_STATE_KEY);
          if (rawIntensive) {
            const parsed = JSON.parse(rawIntensive) as Partial<IntensiveCycleState>;
            setIntensiveCycle({
              active: Boolean(parsed.active),
              reason: typeof parsed.reason === "string" ? parsed.reason : "",
              startedAtIso: typeof parsed.startedAtIso === "string" ? parsed.startedAtIso : null
            });
          }
        } catch {
          localStorage.removeItem(INTENSIVE_STATE_KEY);
        }

        try {
          const rawSummary = localStorage.getItem(INTENSIVE_SUMMARY_KEY);
          if (rawSummary) {
            const parsed = JSON.parse(rawSummary) as Partial<IntensiveCycleSummary>;
            if (
              typeof parsed.closedAtIso === "string" &&
              typeof parsed.reason === "string" &&
              typeof parsed.nightsEvaluated === "number" &&
              typeof parsed.avgOvernightLossPpm === "number" &&
              typeof parsed.lastOvernightLossPpm === "number" &&
              typeof parsed.recommendation === "string"
            ) {
              setIntensiveSummary({
                closedAtIso: parsed.closedAtIso,
                reason: parsed.reason,
                nightsEvaluated: parsed.nightsEvaluated,
                avgOvernightLossPpm: parsed.avgOvernightLossPpm,
                lastOvernightLossPpm: parsed.lastOvernightLossPpm,
                recommendation: parsed.recommendation
              });
            }
          }
        } catch {
          localStorage.removeItem(INTENSIVE_SUMMARY_KEY);
        }
      } catch {
        setError("No se pudieron cargar los datos locales.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    localStorage.setItem(INTENSIVE_STATE_KEY, JSON.stringify(intensiveCycle));
  }, [intensiveCycle]);

  useEffect(() => {
    if (!intensiveSummary) {
      localStorage.removeItem(INTENSIVE_SUMMARY_KEY);
      return;
    }
    localStorage.setItem(INTENSIVE_SUMMARY_KEY, JSON.stringify(intensiveSummary));
  }, [intensiveSummary]);

  const plan = useMemo<ActionPlan | null>(() => {
    if (!config || !canComputePlan(draft, config)) {
      return null;
    }

    const volumeLitersRaw = calculateVolumeLiters(config.pool.diameterM, draft.waterHeightCm!);
    const phPlan = getPhRecommendation(draft.measuredPh!, volumeLitersRaw, config);
    const chlorineDose = calculateChlorineDose(
      draft.measuredChlorinePpm!,
      volumeLitersRaw,
      config.chlorineProduct.concentration,
      config.chlorineProduct.presentation,
      config.targets.chlorineMinPpm,
      config.targets.chlorineMaxPpm
    );

    return {
      volumeLitersRaw,
      volumeLiters: toFixedNumber(volumeLitersRaw, 0),
      phStatus: classifyPh(draft.measuredPh!, config),
      chlorineStatus: classifyChlorine(draft.measuredChlorinePpm!, config),
      phDirection: phPlan.direction,
      phTotal: toFixedNumber(phPlan.total, 0),
      phStage1: toFixedNumber(phPlan.stage1, 0),
      phUnit: phPlan.unit,
      chlorineMaintenance: toFixedNumber(chlorineDose.maintenance, 0),
      chlorineCorrective: toFixedNumber(chlorineDose.corrective, 0),
      chlorineUnit: chlorineDose.unit
    };
  }, [config, draft]);

  const latest = sessions[0];
  const intensiveSessions = useMemo(
    () =>
      sessions
        .filter((session) => session.kind === "intensive-cycle")
        .slice()
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)),
    [sessions]
  );
  const intensiveStats = useMemo(() => {
    const overnightPairs: Array<{ loss: number; morningChlorine: number }> = [];
    const nightCount = intensiveSessions.filter((session) => session.checkMoment === "night").length;

    for (let index = 1; index < intensiveSessions.length; index += 1) {
      const previous = intensiveSessions[index - 1];
      const current = intensiveSessions[index];
      if (previous.checkMoment === "night" && current.checkMoment === "start-day") {
        overnightPairs.push({
          loss: previous.measuredChlorinePpm - current.measuredChlorinePpm,
          morningChlorine: current.measuredChlorinePpm
        });
      }
    }

    const lastPair = overnightPairs.length > 0 ? overnightPairs[overnightPairs.length - 1] : null;
    const neededPairs = config?.workflow.intensiveMinNights ?? 2;
    const threshold = config?.workflow.intensiveMaxOvernightLossPpm ?? 1;
    const recentPairs = overnightPairs.slice(-neededPairs);
    const hasEnoughPairs = recentPairs.length >= neededPairs;
    const stableLoss =
      hasEnoughPairs && recentPairs.every((pair) => pair.loss >= 0 && pair.loss <= threshold);
    const morningsInRange =
      hasEnoughPairs &&
      !!config &&
      recentPairs.every(
        (pair) =>
          pair.morningChlorine >= config.targets.chlorineMinPpm &&
          pair.morningChlorine <= config.targets.chlorineMaxPpm
      );

    return {
      nightCount,
      overnightPairs,
      lastPair,
      canClose: hasEnoughPairs && stableLoss && morningsInRange
    };
  }, [config, intensiveSessions]);

  async function refreshSessions(): Promise<void> {
    const updated = await sessionRepo.list();
    setSessions(updated);
  }

  async function saveMeasureOnly(): Promise<void> {
    if (!config || !plan || saving) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const isIntensiveMeasurement = intensiveCycle.active && draft.forIntensiveCycle;
      const session: Session = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        kind: isIntensiveMeasurement ? "intensive-cycle" : "check",
        checkMoment: draft.checkMoment,
        waterHeightCm: draft.waterHeightCm!,
        measuredPh: draft.measuredPh!,
        measuredChlorinePpm: draft.measuredChlorinePpm!,
        calculatedVolumeLiters: plan.volumeLiters,
        requiredPhCorrection: {
          direction: "none",
          total: 0,
          stage1: 0,
          unit: "ml"
        },
        requiredChlorineDose: {
          maintenance: 0,
          corrective: 0,
          unit: plan.chlorineUnit
        },
        appliedDoses: {},
        notes: draft.notes.trim() || undefined
      };

      await sessionRepo.save(session);
      await refreshSessions();
      setDraft(createDraft(config));
      setScreen(isIntensiveMeasurement ? "intensive-cycle" : "home");
    } catch {
      setError("No se pudo guardar la medicion.");
    } finally {
      setSaving(false);
    }
  }

  async function savePlanSession(): Promise<void> {
    if (!config || !plan || saving) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const isIntensiveMeasurement = intensiveCycle.active && draft.forIntensiveCycle;
      const session: Session = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        kind: isIntensiveMeasurement ? "intensive-cycle" : "adjustment",
        checkMoment: draft.checkMoment,
        waterHeightCm: draft.waterHeightCm!,
        measuredPh: draft.measuredPh!,
        measuredChlorinePpm: draft.measuredChlorinePpm!,
        calculatedVolumeLiters: plan.volumeLiters,
        requiredPhCorrection: {
          direction: plan.phDirection,
          total: plan.phTotal,
          stage1: plan.phStage1,
          unit: plan.phUnit
        },
        requiredChlorineDose: {
          maintenance: plan.chlorineMaintenance,
          corrective: plan.chlorineCorrective,
          unit: plan.chlorineUnit
        },
        appliedDoses: {
          phStage1: plan.phStage1,
          phUnit: plan.phUnit,
          chlorine: plan.chlorineCorrective,
          chlorineUnit: plan.chlorineUnit
        },
        notes: draft.notes.trim() || undefined
      };

      await sessionRepo.save(session);
      await refreshSessions();
      setDraft(createDraft(config));
      setScreen(isIntensiveMeasurement ? "intensive-cycle" : "home");
    } catch {
      setError("No se pudo guardar la sesion con plan de accion.");
    } finally {
      setSaving(false);
    }
  }

  async function saveSettings(): Promise<void> {
    if (!settingsDraft) {
      return;
    }

    if (settingsDraft.pool.diameterM <= 0) {
      setError("El diametro debe ser mayor que 0.");
      return;
    }

    if ((settingsDraft.pool.maxHeightCm ?? 0) <= 0) {
      setError("La altura maxima debe ser mayor que 0.");
      return;
    }

    if (settingsDraft.chlorineProduct.concentration <= 0) {
      setError("La concentracion de cloro debe ser mayor que 0.");
      return;
    }

    if (settingsDraft.acidProduct.concentration <= 0) {
      setError("La concentracion de HCl debe ser mayor que 0.");
      return;
    }

    if (settingsDraft.phUpProduct.enabled && settingsDraft.phUpProduct.concentration <= 0) {
      setError("La concentracion de pH+ debe ser mayor que 0.");
      return;
    }

    if (settingsDraft.targets.phMin >= settingsDraft.targets.phMax) {
      setError("El objetivo de pH minimo debe ser menor al maximo.");
      return;
    }

    if (settingsDraft.targets.chlorineMinPpm >= settingsDraft.targets.chlorineMaxPpm) {
      setError("El objetivo de cloro minimo debe ser menor al maximo.");
      return;
    }

    if (settingsDraft.workflow.maxWaitMinutes > 60) {
      setError("La pausa maxima no puede superar 60 minutos.");
      return;
    }

    if (settingsDraft.workflow.defaultWaitMinutes > settingsDraft.workflow.maxWaitMinutes) {
      setError("La pausa por defecto no puede superar la pausa maxima.");
      return;
    }

    if (settingsDraft.workflow.intensiveMinNights < 2) {
      setError("El ciclo intensivo requiere al menos 2 noches.");
      return;
    }

    if (settingsDraft.workflow.intensiveMaxOvernightLossPpm <= 0) {
      setError("El umbral de perdida nocturna del ciclo intensivo debe ser mayor a 0.");
      return;
    }

    try {
      setError(null);
      await configRepo.save(settingsDraft);
      setConfig(settingsDraft);
      setDraft((prev) => ({
        ...prev,
        waitMinutes: settingsDraft.workflow.defaultWaitMinutes
      }));
      setScreen("home");
    } catch {
      setError("No se pudieron guardar los ajustes.");
    }
  }

  function startIntensiveCycle(reason: string): void {
    if (!reason.trim()) {
      setError("Ingresa un motivo para iniciar el ciclo intensivo.");
      return;
    }

    setError(null);
    setIntensiveCycle({
      active: true,
      reason: reason.trim(),
      startedAtIso: new Date().toISOString()
    });
  }

  function closeIntensiveCycle(): void {
    if (!intensiveStats.canClose) {
      setError("Aun no se cumplen los criterios para cerrar el ciclo intensivo.");
      return;
    }

    const nightsEvaluated = Math.min(
      config?.workflow.intensiveMinNights ?? 2,
      intensiveStats.overnightPairs.length
    );
    const evaluatedPairs = intensiveStats.overnightPairs.slice(-nightsEvaluated);
    const avgOvernightLossPpm =
      evaluatedPairs.reduce((sum, pair) => sum + pair.loss, 0) / evaluatedPairs.length;
    const lastOvernightLossPpm = evaluatedPairs[evaluatedPairs.length - 1]?.loss ?? avgOvernightLossPpm;
    const recommendation =
      avgOvernightLossPpm <= (config?.workflow.intensiveMaxOvernightLossPpm ?? 1)
        ? "Patron estabilizado. Volver al flujo diario con dosis correctiva solo cuando el cloro caiga bajo objetivo."
        : "Patron aun exigente. Mantener monitoreo diario y considerar extender ciclo 1 noche adicional.";

    setError(null);
    setIntensiveCycle(createDefaultIntensiveCycleState());
    setIntensiveSummary({
      closedAtIso: new Date().toISOString(),
      reason: intensiveCycle.reason || "ciclo intensivo",
      nightsEvaluated,
      avgOvernightLossPpm: toFixedNumber(avgOvernightLossPpm, 2),
      lastOvernightLossPpm: toFixedNumber(lastOvernightLossPpm, 2),
      recommendation
    });
    setScreen("home");
  }

  if (loading || !config || !settingsDraft) {
    return <main className="app-shell">Cargando configuracion...</main>;
  }

  const waitOptions = WAIT_OPTIONS.filter((minutes) => minutes <= config.workflow.maxWaitMinutes);
  const planHasAdjustments =
    plan !== null &&
    (plan.phDirection !== "none" || plan.chlorineCorrective > 0 || plan.chlorineMaintenance > 0);
  const primaryPlanActionLabel = !planHasAdjustments
    ? "Guardar medicion (sin ajustes)"
    : "Guardar plan y medicion";
  const intensiveEntryVisible = config.workflow.enableIntensiveCycle || intensiveCycle.active;

  return (
    <main className="app-shell">
      <div className="bg-orb bg-orb-a" />
      <div className="bg-orb bg-orb-b" />
      <header className="app-header">
        <p className="app-kicker">Mantenimiento diario</p>
        <div className="title-row">
          <img
            className="app-logo"
            src={`${import.meta.env.BASE_URL}icons/icon-128x128.png`}
            alt="Icono Piscina PWA"
          />
          <h1 className="app-title">Piscina PWA</h1>
        </div>
        <p className="app-subtitle">
          Flujo central: registrar mediciones y obtener plan de accion con soporte para hipoclorito o
          dicloro granulado.
        </p>
      </header>

      {error ? <p className="error-text">{error}</p> : null}

      {screen === "home" ? (
        <section className="card">
          <h2 className="section-title">Inicio</h2>
          <div className="metrics-grid">
            <article className="metric">
              <p className="metric-label">Producto cloro activo</p>
              <p className="metric-value">
                {config.chlorineProduct.type} ({config.chlorineProduct.concentration}% -{" "}
                {config.chlorineProduct.presentation === "granular-g" ? "granulado" : "liquido"})
              </p>
            </article>
            <article className="metric">
              <p className="metric-label">Control pH</p>
              <p className="metric-value">
                Baja: {config.acidProduct.type} {config.acidProduct.concentration}%
                <br />
                Sube: {config.phUpProduct.enabled ? config.phUpProduct.type : "Desactivado"}
              </p>
            </article>
            <article className="metric">
              <p className="metric-label">Objetivo pH</p>
              <p className="metric-value">
                {config.targets.phMin} - {config.targets.phMax}
              </p>
            </article>
            <article className="metric">
              <p className="metric-label">Objetivo cloro</p>
              <p className="metric-value">
                {config.targets.chlorineMinPpm} - {config.targets.chlorineMaxPpm} ppm
              </p>
            </article>
          </div>

          {latest ? (
            <div className="latest-session">
              <p className="latest-title">Ultima medicion</p>
              <p>
                {new Date(latest.timestamp).toLocaleString()} | pH {latest.measuredPh} | Cl{" "}
                {latest.measuredChlorinePpm} ppm
              </p>
            </div>
          ) : (
            <p className="inline-note">Todavia no hay mediciones guardadas.</p>
          )}
          {intensiveCycle.active ? (
            <p className="status-pill status-warn">
              Ciclo intensivo activo: {intensiveCycle.reason || "sin motivo"}.
            </p>
          ) : null}
          {intensiveSummary ? (
            <div className="latest-session">
              <p className="latest-title">Ultimo cierre de ciclo intensivo</p>
              <p>
                {new Date(intensiveSummary.closedAtIso).toLocaleString()} | Noches evaluadas:{" "}
                {intensiveSummary.nightsEvaluated}
              </p>
              <p>
                Perdida nocturna promedio: {intensiveSummary.avgOvernightLossPpm} ppm | Ultima:{" "}
                {intensiveSummary.lastOvernightLossPpm} ppm
              </p>
              <p className="inline-note">{intensiveSummary.recommendation}</p>
            </div>
          ) : null}

          <div className="actions">
            <button
              className="btn-primary"
              type="button"
              onClick={() => {
                setDraft(createDraft(config));
                setScreen("measure");
              }}
            >
              Medicion + plan de accion
            </button>
            <button
              className="btn-secondary"
              type="button"
              onClick={() => {
                setDraft({ ...createDraft(config), mode: "measure-only" });
                setScreen("measure");
              }}
            >
              Medicion fuera de ciclo
            </button>
            <button className="btn-secondary" type="button" onClick={() => setScreen("history")}>
              Historial
            </button>
            <button className="btn-secondary" type="button" onClick={() => setScreen("settings")}>
              Configuracion
            </button>
            <button className="btn-secondary" type="button" onClick={() => setScreen("help")}>
              Ayuda del flujo
            </button>
            {intensiveEntryVisible ? (
              <button className="btn-secondary" type="button" onClick={() => setScreen("intensive-cycle")}>
                Ciclo intensivo
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {screen === "measure" ? (
        <section className="card">
          <h2 className="section-title">Ingreso de medicion</h2>
          <p className="inline-note">Modo activo: {getMeasureModeLabel(draft.mode)}</p>
          {draft.forIntensiveCycle ? (
            <p className="status-pill status-warn">Registro vinculado a ciclo intensivo.</p>
          ) : null}
          <label className="field-label">
            Modo
            <select
              className="field-input"
              value={draft.mode}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  mode: event.target.value === "measure-only" ? "measure-only" : "plan"
                }))
              }
            >
              <option value="plan">Generar plan de accion</option>
              <option value="measure-only">Medicion fuera de ciclo (solo registro)</option>
            </select>
          </label>

          <label className="field-label">
            Momento de la medicion
            <select
              className="field-input"
              value={draft.checkMoment}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  checkMoment:
                    event.target.value === "sun-hours" || event.target.value === "night"
                      ? event.target.value
                      : "start-day"
                }))
              }
            >
              <option value="start-day">Inicio del dia</option>
              <option value="sun-hours">Horas de sol</option>
              <option value="night">Noche</option>
            </select>
          </label>

          <label className="field-label">
            Altura actual (cm)
            <input
              className="field-input"
              type="number"
              min={1}
              max={config.pool.maxHeightCm ?? 200}
              value={draft.waterHeightCm ?? ""}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  waterHeightCm: event.target.value === "" ? null : Number(event.target.value)
                }))
              }
            />
          </label>

          <label className="field-label">
            pH medido
            <input
              className="field-input"
              type="number"
              min={6.8}
              max={8.2}
              step={0.1}
              value={draft.measuredPh ?? ""}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  measuredPh: event.target.value === "" ? null : Number(event.target.value)
                }))
              }
            />
          </label>

          <label className="field-label">
            Cloro medido (ppm)
            <input
              className="field-input"
              type="number"
              min={0}
              max={10}
              step={0.1}
              value={draft.measuredChlorinePpm ?? ""}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  measuredChlorinePpm:
                    event.target.value === "" ? null : Number(event.target.value)
                }))
              }
            />
          </label>
          {plan ? (
            <div className="status-row">
              <span className={`status-pill ${statusTone(plan.phStatus)}`}>
                pH: {getStatusLabel(plan.phStatus)}
              </span>
              <span className={`status-pill ${statusTone(plan.chlorineStatus)}`}>
                Cloro: {getStatusLabel(plan.chlorineStatus)}
              </span>
            </div>
          ) : null}

          {draft.mode === "plan" ? (
            <label className="field-label">
              Pausa antes de re-medicion de pH
              <select
                className="field-input"
                value={draft.waitMinutes}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    waitMinutes: Number(event.target.value)
                  }))
                }
              >
                {waitOptions.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} minutos
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="field-label">
            Notas
            <textarea
              className="field-input textarea-input"
              rows={3}
              value={draft.notes}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  notes: event.target.value
                }))
              }
            />
          </label>

          <div className="actions">
            {draft.mode === "plan" ? (
              <button
                className="btn-primary"
                type="button"
                disabled={!canComputePlan(draft, config)}
                onClick={() => setScreen("plan")}
              >
                Ver plan de accion
              </button>
            ) : (
              <button
                className="btn-primary"
                type="button"
                disabled={!canComputePlan(draft, config) || saving}
                onClick={() => void saveMeasureOnly()}
              >
                {saving ? "Guardando..." : "Guardar medicion"}
              </button>
            )}
            <button className="btn-secondary" type="button" onClick={() => setScreen("home")}>
              Volver al inicio
            </button>
          </div>
        </section>
      ) : null}

      {screen === "plan" && plan ? (
        <section className="card">
          <h2 className="section-title">Plan de accion</h2>
          <p>Volumen estimado: {plan.volumeLiters} L</p>
          <div className="status-row">
            <span className={`status-pill ${statusTone(plan.phStatus)}`}>
              pH: {getStatusLabel(plan.phStatus)}
            </span>
            <span className={`status-pill ${statusTone(plan.chlorineStatus)}`}>
              Cloro: {getStatusLabel(plan.chlorineStatus)}
            </span>
          </div>

          <div className="metrics-grid">
            <article className="metric">
              <p className="metric-label">Correccion de pH (etapa 1)</p>
              <p className="metric-value">
                {plan.phStage1} {plan.phUnit}
              </p>
            </article>
            <article className="metric">
              <p className="metric-label">Correccion de pH (total)</p>
              <p className="metric-value">
                {plan.phTotal} {plan.phUnit}
              </p>
            </article>
            <article className="metric">
              <p className="metric-label">Cloro hasta minimo</p>
              <p className="metric-value">
                {plan.chlorineMaintenance} {plan.chlorineUnit}
              </p>
            </article>
            <article className="metric">
              <p className="metric-label">Cloro hasta valor central</p>
              <p className="metric-value">
                {plan.chlorineCorrective} {plan.chlorineUnit}
              </p>
            </article>
          </div>

          {plan.phDirection === "down" ? (
            <p className="inline-note">
              pH alto: aplicar {plan.phStage1} {plan.phUnit} de {config.acidProduct.type}, recircular y
              esperar {draft.waitMinutes} min (max {config.workflow.maxWaitMinutes} min) antes de
              re-medir.
            </p>
          ) : null}

          {plan.phDirection === "up" ? (
            <p className="inline-note">
              pH bajo: aplicar {plan.phStage1} {plan.phUnit} de {config.phUpProduct.type} en primera
              etapa, esperar {draft.waitMinutes} min y re-medir antes de completar.
            </p>
          ) : null}

          {plan.phDirection === "none" ? (
            <p className="inline-note">pH en rango objetivo: no se requiere ajuste de pH.</p>
          ) : null}

          {plan.chlorineCorrective <= 0 ? (
            <p className="inline-note">Cloro en rango: no se requiere correccion de mantenimiento.</p>
          ) : (
            <p className="inline-note">
              Producto configurado: {config.chlorineProduct.type} ({config.chlorineProduct.concentration}% -{" "}
              {plan.chlorineUnit}).
            </p>
          )}
          <p className={planHasAdjustments ? "status-pill status-warn" : "status-pill status-ok"}>
            Recomendacion principal:{" "}
            {planHasAdjustments
              ? "aplicar etapa 1 de pH y/o ajuste de cloro, luego registrar."
              : "registrar medicion y continuar monitoreo diario."}
          </p>

          <div className="actions">
            <button
              className="btn-primary"
              type="button"
              onClick={() => void (planHasAdjustments ? savePlanSession() : saveMeasureOnly())}
              disabled={saving}
            >
              {saving ? "Guardando..." : primaryPlanActionLabel}
            </button>
            {planHasAdjustments ? (
              <button
                className="btn-secondary"
                type="button"
                onClick={() => void saveMeasureOnly()}
                disabled={saving}
              >
                Guardar solo medicion
              </button>
            ) : null}
            <button className="btn-secondary" type="button" onClick={() => setScreen("measure")}>
              Editar medicion
            </button>
          </div>
        </section>
      ) : null}

      {screen === "intensive-cycle" ? (
        <section className="card">
          <h2 className="section-title">Ciclo intensivo</h2>
          {!intensiveCycle.active ? (
            <>
              {intensiveSummary ? (
                <div className="latest-session">
                  <p className="latest-title">Resumen ultimo cierre</p>
                  <p>
                    Motivo: {intensiveSummary.reason} | {new Date(intensiveSummary.closedAtIso).toLocaleString()}
                  </p>
                  <p>
                    Noches: {intensiveSummary.nightsEvaluated} | Promedio:{" "}
                    {intensiveSummary.avgOvernightLossPpm} ppm | Ultima:{" "}
                    {intensiveSummary.lastOvernightLossPpm} ppm
                  </p>
                  <p className="inline-note">{intensiveSummary.recommendation}</p>
                </div>
              ) : null}
              <p className="inline-note">
                Flujo avanzado para estabilizar comportamiento del cloro tras cambio de producto o inicio
                de temporada. Requiere al menos {config.workflow.intensiveMinNights} noches.
              </p>
              <label className="field-label">
                Motivo del ciclo
                <select
                  className="field-input"
                  value={intensiveReasonDraft}
                  onChange={(event) => setIntensiveReasonDraft(event.target.value)}
                >
                  <option value="cambio a dicloro">Cambio a dicloro</option>
                  <option value="inicio de temporada">Inicio de temporada</option>
                  <option value="cloro inestable">Cloro inestable</option>
                </select>
              </label>
              <div className="actions">
                <button
                  className="btn-primary"
                  type="button"
                  onClick={() => startIntensiveCycle(intensiveReasonDraft)}
                >
                  Iniciar ciclo intensivo
                </button>
                {intensiveSummary ? (
                  <button
                    className="btn-secondary"
                    type="button"
                    onClick={() => setIntensiveSummary(null)}
                  >
                    Limpiar resumen anterior
                  </button>
                ) : null}
                <button className="btn-secondary" type="button" onClick={() => setScreen("settings")}>
                  Volver a configuracion
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="status-pill status-warn">
                Activo desde{" "}
                {intensiveCycle.startedAtIso ? new Date(intensiveCycle.startedAtIso).toLocaleString() : "-"}.
              </p>
              <p className="inline-note">Motivo: {intensiveCycle.reason || "-"}</p>
              <div className="metrics-grid">
                <article className="metric">
                  <p className="metric-label">Noches registradas</p>
                  <p className="metric-value">{intensiveStats.nightCount}</p>
                </article>
                <article className="metric">
                  <p className="metric-label">Pares noche a inicio dia</p>
                  <p className="metric-value">{intensiveStats.overnightPairs.length}</p>
                </article>
                <article className="metric">
                  <p className="metric-label">Ultima perdida nocturna</p>
                  <p className="metric-value">
                    {intensiveStats.lastPair
                      ? `${toFixedNumber(intensiveStats.lastPair.loss, 2)} ppm`
                      : "Sin datos"}
                  </p>
                </article>
                <article className="metric">
                  <p className="metric-label">Criterio de cierre</p>
                  <p className="metric-value">
                    {intensiveStats.canClose
                      ? "Cumplido"
                      : `Pendiente (<= ${config.workflow.intensiveMaxOvernightLossPpm} ppm por noche)`}
                  </p>
                </article>
              </div>
              <div className="actions">
                <button
                  className="btn-primary"
                  type="button"
                  onClick={() => {
                    setDraft({
                      ...createDraft(config),
                      mode: "plan",
                      forIntensiveCycle: true
                    });
                    setScreen("measure");
                  }}
                >
                  Registrar medicion del ciclo
                </button>
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={closeIntensiveCycle}
                  disabled={!intensiveStats.canClose}
                >
                  Cerrar ciclo
                </button>
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => setIntensiveCycle(createDefaultIntensiveCycleState())}
                >
                  Cancelar ciclo
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {screen === "history" ? (
        <section className="card">
          <h2 className="section-title">Historial</h2>
          {sessions.length === 0 ? <p>No hay sesiones guardadas.</p> : null}
          {sessions.map((session) => {
            const phUnit = session.requiredPhCorrection.unit ?? "ml";
            const chlorineUnit = session.requiredChlorineDose.unit ?? "ml";

            return (
              <article className="history-item" key={session.id}>
                <p>{new Date(session.timestamp).toLocaleString()}</p>
                <p>
                  Tipo:{" "}
                  {session.kind === "intensive-cycle"
                    ? "Ciclo intensivo"
                    : session.kind === "check"
                      ? "Medicion"
                      : "Plan de accion"}{" "}
                  | Momento: {session.checkMoment ?? "-"}
                </p>
                <p>
                  Altura {session.waterHeightCm} cm | pH {session.measuredPh} | Cl{" "}
                  {session.measuredChlorinePpm} ppm
                </p>
                <p>
                  pH etapa 1: {toFixedNumber(getLegacyPhStage1(session), 0)} {phUnit} | pH total:{" "}
                  {toFixedNumber(getLegacyPhTotal(session), 0)} {phUnit}
                </p>
                <p>
                  Cl mantencion: {toFixedNumber(getLegacyChlorineMaintenance(session), 0)} {chlorineUnit}
                  {" "}| Cl correctiva: {toFixedNumber(getLegacyChlorineCorrective(session), 0)} {chlorineUnit}
                </p>
                {session.notes ? <p>Notas: {session.notes}</p> : null}
              </article>
            );
          })}
          <div className="actions">
            <button className="btn-secondary" type="button" onClick={() => setScreen("home")}>
              Volver
            </button>
          </div>
        </section>
      ) : null}

      {screen === "settings" ? (
        <section className="card">
          <h2 className="section-title">Configuracion</h2>

          <label className="field-label">
            Diametro piscina (m)
            <input
              className="field-input"
              type="number"
              min={1}
              step={0.01}
              value={settingsDraft.pool.diameterM}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? { ...prev, pool: { ...prev.pool, diameterM: Number(event.target.value) } }
                    : prev
                )
              }
            />
          </label>

          <label className="field-label">
            Altura maxima (cm)
            <input
              className="field-input"
              type="number"
              min={1}
              value={settingsDraft.pool.maxHeightCm ?? ""}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? { ...prev, pool: { ...prev.pool, maxHeightCm: Number(event.target.value) } }
                    : prev
                )
              }
            />
          </label>

          <label className="field-label">
            Producto de cloro
            <select
              className="field-input"
              value={`${settingsDraft.chlorineProduct.presentation}:${settingsDraft.chlorineProduct.type}`}
              onChange={(event) => {
                const selected = event.target.value;
                if (selected === "liquid-ml:Hipoclorito de sodio") {
                  setSettingsDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          chlorineProduct: {
                            ...prev.chlorineProduct,
                            type: "Hipoclorito de sodio",
                            concentration: 5,
                            presentation: "liquid-ml"
                          }
                        }
                      : prev
                  );
                  return;
                }

                if (selected === "granular-g:Dicloroisocianurato de sodio") {
                  setSettingsDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          chlorineProduct: {
                            ...prev.chlorineProduct,
                            type: "Dicloroisocianurato de sodio",
                            concentration: 56,
                            presentation: "granular-g"
                          }
                        }
                      : prev
                  );
                }
              }}
            >
              <option value="liquid-ml:Hipoclorito de sodio">Hipoclorito de sodio (liquido)</option>
              <option value="granular-g:Dicloroisocianurato de sodio">
                Dicloroisocianurato de sodio (granulado)
              </option>
            </select>
          </label>

          <label className="field-label">
            Nombre producto de cloro
            <input
              className="field-input"
              type="text"
              value={settingsDraft.chlorineProduct.type}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        chlorineProduct: { ...prev.chlorineProduct, type: event.target.value }
                      }
                    : prev
                )
              }
            />
          </label>

          <label className="field-label">
            Concentracion cloro (%)
            <input
              className="field-input"
              type="number"
              min={0.1}
              step={0.1}
              value={settingsDraft.chlorineProduct.concentration}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        chlorineProduct: {
                          ...prev.chlorineProduct,
                          concentration: Number(event.target.value)
                        }
                      }
                    : prev
                )
              }
            />
          </label>

          <label className="field-label">
            Presentacion de cloro
            <select
              className="field-input"
              value={settingsDraft.chlorineProduct.presentation}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        chlorineProduct: {
                          ...prev.chlorineProduct,
                          presentation:
                            event.target.value === "granular-g" ? "granular-g" : "liquid-ml"
                        }
                      }
                    : prev
                )
              }
            >
              <option value="liquid-ml">Liquido (ml)</option>
              <option value="granular-g">Granulado (g)</option>
            </select>
          </label>

          <label className="field-label">
            Producto para bajar pH
            <input
              className="field-input"
              type="text"
              value={settingsDraft.acidProduct.type}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        acidProduct: {
                          ...prev.acidProduct,
                          type: event.target.value
                        }
                      }
                    : prev
                )
              }
            />
          </label>

          <label className="field-label">
            Concentracion HCl (%)
            <input
              className="field-input"
              type="number"
              min={0.1}
              step={0.1}
              value={settingsDraft.acidProduct.concentration}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        acidProduct: {
                          ...prev.acidProduct,
                          concentration: Number(event.target.value)
                        }
                      }
                    : prev
                )
              }
            />
          </label>

          <label className="check-item">
            <input
              type="checkbox"
              checked={settingsDraft.phUpProduct.enabled}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        phUpProduct: {
                          ...prev.phUpProduct,
                          enabled: event.target.checked
                        }
                      }
                    : prev
                )
              }
            />
            Habilitar ajuste para subir pH
          </label>

          <label className="field-label">
            Producto para subir pH
            <input
              className="field-input"
              type="text"
              value={settingsDraft.phUpProduct.type}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        phUpProduct: {
                          ...prev.phUpProduct,
                          type: event.target.value
                        }
                      }
                    : prev
                )
              }
            />
          </label>

          <label className="field-label">
            Concentracion pH+ (%)
            <input
              className="field-input"
              type="number"
              min={0.1}
              step={0.1}
              value={settingsDraft.phUpProduct.concentration}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        phUpProduct: {
                          ...prev.phUpProduct,
                          concentration: Number(event.target.value)
                        }
                      }
                    : prev
                )
              }
            />
          </label>

          <label className="field-label">
            Dosis referencial pH+ (g por 0.1 pH por 10.000 L)
            <input
              className="field-input"
              type="number"
              min={1}
              step={1}
              value={settingsDraft.phUpProduct.referenceDoseGPerPointPer10kL}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        phUpProduct: {
                          ...prev.phUpProduct,
                          referenceDoseGPerPointPer10kL: Number(event.target.value)
                        }
                      }
                    : prev
                )
              }
            />
          </label>

          <label className="field-label">
            Pausa por defecto (min)
            <input
              className="field-input"
              type="number"
              min={15}
              max={60}
              step={15}
              value={settingsDraft.workflow.defaultWaitMinutes}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        workflow: {
                          ...prev.workflow,
                          defaultWaitMinutes: Number(event.target.value)
                        }
                      }
                    : prev
                )
              }
            />
          </label>

          <label className="field-label">
            Pausa maxima (min)
            <input
              className="field-input"
              type="number"
              min={15}
              max={60}
              step={15}
              value={settingsDraft.workflow.maxWaitMinutes}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        workflow: {
                          ...prev.workflow,
                          maxWaitMinutes: Number(event.target.value)
                        }
                      }
                    : prev
                )
              }
            />
          </label>

          <label className="check-item">
            <input
              type="checkbox"
              checked={settingsDraft.workflow.enableIntensiveCycle}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        workflow: {
                          ...prev.workflow,
                          enableIntensiveCycle: event.target.checked
                        }
                      }
                    : prev
                )
              }
            />
            Habilitar ciclo intensivo (operacion avanzada)
          </label>

          <label className="field-label">
            Minimo de noches para cierre del ciclo
            <input
              className="field-input"
              type="number"
              min={2}
              step={1}
              value={settingsDraft.workflow.intensiveMinNights}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        workflow: {
                          ...prev.workflow,
                          intensiveMinNights: Number(event.target.value)
                        }
                      }
                    : prev
                )
              }
            />
          </label>

          <label className="field-label">
            Umbral perdida nocturna objetivo (ppm)
            <input
              className="field-input"
              type="number"
              min={0.1}
              step={0.1}
              value={settingsDraft.workflow.intensiveMaxOvernightLossPpm}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        workflow: {
                          ...prev.workflow,
                          intensiveMaxOvernightLossPpm: Number(event.target.value)
                        }
                      }
                    : prev
                )
              }
            />
          </label>
          {settingsDraft.workflow.enableIntensiveCycle || intensiveCycle.active ? (
            <button
              className="btn-secondary"
              type="button"
              onClick={() => setScreen("intensive-cycle")}
            >
              Abrir ciclo intensivo
            </button>
          ) : null}

          <label className="field-label">
            TA estimada (ppm)
            <input
              className="field-input"
              type="number"
              min={1}
              step={1}
              value={settingsDraft.chemistry.estimatedAlkalinityPpm}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        chemistry: {
                          ...prev.chemistry,
                          estimatedAlkalinityPpm: Number(event.target.value)
                        }
                      }
                    : prev
                )
              }
            />
          </label>

          <label className="field-label">
            pH minimo objetivo
            <input
              className="field-input"
              type="number"
              min={6.8}
              max={8.2}
              step={0.1}
              value={settingsDraft.targets.phMin}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        targets: {
                          ...prev.targets,
                          phMin: Number(event.target.value)
                        }
                      }
                    : prev
                )
              }
            />
          </label>

          <label className="field-label">
            pH maximo objetivo
            <input
              className="field-input"
              type="number"
              min={6.8}
              max={8.2}
              step={0.1}
              value={settingsDraft.targets.phMax}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        targets: {
                          ...prev.targets,
                          phMax: Number(event.target.value)
                        }
                      }
                    : prev
                )
              }
            />
          </label>

          <label className="field-label">
            Cloro minimo objetivo (ppm)
            <input
              className="field-input"
              type="number"
              min={0}
              max={10}
              step={0.1}
              value={settingsDraft.targets.chlorineMinPpm}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        targets: {
                          ...prev.targets,
                          chlorineMinPpm: Number(event.target.value)
                        }
                      }
                    : prev
                )
              }
            />
          </label>

          <label className="field-label">
            Cloro maximo objetivo (ppm)
            <input
              className="field-input"
              type="number"
              min={0}
              max={10}
              step={0.1}
              value={settingsDraft.targets.chlorineMaxPpm}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        targets: {
                          ...prev.targets,
                          chlorineMaxPpm: Number(event.target.value)
                        }
                      }
                    : prev
                )
              }
            />
          </label>

          <div className="actions">
            <button className="btn-primary" type="button" onClick={() => void saveSettings()}>
              Guardar configuracion
            </button>
            <button className="btn-secondary" type="button" onClick={() => setScreen("home")}>
              Cancelar
            </button>
          </div>
        </section>
      ) : null}

      {screen === "help" ? (
        <section className="card">
          <h2 className="section-title">Ayuda del nuevo flujo</h2>
          <ol className="help-list">
            <li>Configura tus productos: cloro (hipoclorito o dicloro), HCl para bajar pH y pH+.</li>
            <li>Registra una medicion y elige si quieres plan de accion o solo historial.</li>
            <li>
              Cuando el pH esta fuera de rango, aplica etapa 1 (50%), espera entre 15 y 60 minutos, y
              re-mide.
            </li>
            <li>
              El plan diferencia dosis de cloro de mantencion (minimo) y correctiva (valor central del
              rango).
            </li>
            <li>
              El ciclo intensivo se habilita desde Configuracion y sirve para estabilizar 2+ noches tras
              cambio de producto o inicio de temporada.
            </li>
          </ol>
          <p className="inline-note">
            Nota: si usas dicloro granulado al 56% en piscina destapada, monitorea CYA en el tiempo para
            evitar sobreestabilizacion.
          </p>
          <div className="actions">
            <button className="btn-secondary" type="button" onClick={() => setScreen("home")}>
              Volver
            </button>
          </div>
        </section>
      ) : null}

      {screen !== "home" ? (
        <nav className="quick-nav" aria-label="Atajos">
          <button className="chip-btn" type="button" onClick={() => setScreen("home")}>
            Inicio
          </button>
          <button className="chip-btn" type="button" onClick={() => setScreen("measure")}>
            Medicion
          </button>
          <button className="chip-btn" type="button" onClick={() => setScreen("settings")}>
            Configuracion
          </button>
        </nav>
      ) : null}
    </main>
  );
}
