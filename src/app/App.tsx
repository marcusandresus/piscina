import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { configRepo } from "../data/repositories/configRepo";
import { sessionRepo } from "../data/repositories/sessionRepo";
import {
  calculateChlorineDoseMl,
  calculatePhCorrectionMl,
  calculateVolumeLiters,
  classifyChlorine,
  classifyPh,
  estimatePhAfterAcidDose,
  getStatusLabel,
  isChlorineInRange,
  isHeightInRange,
  isPhInRange,
  toFixedNumber
} from "../domain/calculations";
import { defaultPoolConfig } from "../domain/defaults";
import type { PoolConfig, Session } from "../domain/types";
import "./App.css";

type Screen =
  | "home"
  | "help"
  | "new-height"
  | "new-ph"
  | "new-chlorine"
  | "results"
  | "ph-stage1"
  | "wait"
  | "chlorine-correction"
  | "post-checklist"
  | "history"
  | "settings";

interface DraftSessionInput {
  waterHeightCm: number | null;
  measuredPh: number | null;
  appliedPhStage1Ml: number | null;
  measuredPhIntermediate: number | null;
  measuredChlorinePpm: number | null;
}

interface PostApplicationDraft {
  pumpOn: boolean;
  dilutedCorrectly: boolean;
  perimeterApplication: boolean;
  waitRespected: boolean;
  notes: string;
}

interface PersistedUiState {
  screen: Screen;
  draft: DraftSessionInput;
  postDraft: PostApplicationDraft;
}

const defaultPostApplicationDraft: PostApplicationDraft = {
  pumpOn: false,
  dilutedCorrectly: false,
  perimeterApplication: false,
  waitRespected: false,
  notes: ""
};

const UI_STATE_KEY = "piscina-ui-state-v1";
const PH_CHART_MIN = 6.8;
const PH_CHART_MAX = 8.2;
const TA_SENSITIVITY_LEVELS = [60, 80, 100, 120, 140];
const SESSION_FLOW_SCREENS: Screen[] = [
  "results",
  "ph-stage1",
  "wait",
  "chlorine-correction",
  "post-checklist"
];

function isScreen(value: unknown): value is Screen {
  if (typeof value !== "string") {
    return false;
  }

  return (
    value === "home" ||
    value === "help" ||
    value === "new-height" ||
    value === "new-ph" ||
    value === "new-chlorine" ||
    value === "results" ||
    value === "ph-stage1" ||
    value === "wait" ||
    value === "chlorine-correction" ||
    value === "post-checklist" ||
    value === "history" ||
    value === "settings"
  );
}

function isValidDraftForResults(draft: DraftSessionInput, config: PoolConfig): boolean {
  return (
    draft.waterHeightCm !== null &&
    draft.measuredPh !== null &&
    draft.measuredChlorinePpm !== null &&
    isHeightInRange(draft.waterHeightCm, config.pool.maxHeightCm) &&
    isPhInRange(draft.measuredPh) &&
    isChlorineInRange(draft.measuredChlorinePpm)
  );
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
    chemistry: {
      ...defaultPoolConfig.chemistry,
      ...loaded.chemistry
    },
    targets: {
      ...defaultPoolConfig.targets,
      ...loaded.targets
    }
  };
}

export function App() {
  const [config, setConfig] = useState<PoolConfig | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [screen, setScreen] = useState<Screen>("home");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftSessionInput>({
    waterHeightCm: null,
    measuredPh: null,
    appliedPhStage1Ml: null,
    measuredPhIntermediate: null,
    measuredChlorinePpm: null
  });
  const [postDraft, setPostDraft] = useState<PostApplicationDraft>(defaultPostApplicationDraft);
  const [settingsDraft, setSettingsDraft] = useState<PoolConfig | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const loaded = await configRepo.load();
        const nextConfig = normalizeConfig(loaded);

        if (!loaded) {
          await configRepo.save(defaultPoolConfig);
        }

        const loadedSessions = await sessionRepo.list();
        setConfig(nextConfig);
        setSettingsDraft(nextConfig);
        setSessions(loadedSessions);

        try {
          const rawState = localStorage.getItem(UI_STATE_KEY);
          if (!rawState) {
            return;
          }

          const restored = JSON.parse(rawState) as Partial<PersistedUiState>;
          if (!isScreen(restored.screen)) {
            return;
          }

          const restoredDraft: DraftSessionInput = {
            waterHeightCm:
              typeof restored.draft?.waterHeightCm === "number"
                ? restored.draft.waterHeightCm
                : null,
            measuredPh:
              typeof restored.draft?.measuredPh === "number" ? restored.draft.measuredPh : null,
            appliedPhStage1Ml:
              typeof restored.draft?.appliedPhStage1Ml === "number"
                ? restored.draft.appliedPhStage1Ml
                : null,
            measuredPhIntermediate:
              typeof restored.draft?.measuredPhIntermediate === "number"
                ? restored.draft.measuredPhIntermediate
                : null,
            measuredChlorinePpm:
              typeof restored.draft?.measuredChlorinePpm === "number"
                ? restored.draft.measuredChlorinePpm
                : null
          };

          const restoredPostDraft: PostApplicationDraft = {
            pumpOn: Boolean(restored.postDraft?.pumpOn),
            dilutedCorrectly: Boolean(restored.postDraft?.dilutedCorrectly),
            perimeterApplication: Boolean(restored.postDraft?.perimeterApplication),
            waitRespected: Boolean(restored.postDraft?.waitRespected),
            notes: typeof restored.postDraft?.notes === "string" ? restored.postDraft.notes : ""
          };

          setDraft(restoredDraft);
          setPostDraft(restoredPostDraft);

          if (
            SESSION_FLOW_SCREENS.includes(restored.screen) &&
            !isValidDraftForResults(restoredDraft, nextConfig)
          ) {
            setScreen("new-height");
            return;
          }

          setScreen(restored.screen);
        } catch {
          localStorage.removeItem(UI_STATE_KEY);
        }
      } catch {
        setError("No se pudo cargar datos locales.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const canGoResults =
    draft.waterHeightCm !== null &&
    draft.measuredPh !== null &&
    draft.measuredChlorinePpm !== null &&
    config !== null &&
    isHeightInRange(draft.waterHeightCm, config.pool.maxHeightCm) &&
    isPhInRange(draft.measuredPh) &&
    isChlorineInRange(draft.measuredChlorinePpm);

  const computed = useMemo(() => {
    if (!config || !canGoResults) {
      return null;
    }

    const volumeLiters = calculateVolumeLiters(config.pool.diameterM, draft.waterHeightCm!);
    const totalPhMlRaw = calculatePhCorrectionMl(
      draft.measuredPh!,
      volumeLiters,
      config.acidProduct.concentration,
      config.targets.phMax,
      config.chemistry.estimatedAlkalinityPpm
    );
    const stage1PhMlRaw = totalPhMlRaw * 0.5;
    const chlorineDose = calculateChlorineDoseMl(
      draft.measuredChlorinePpm!,
      volumeLiters,
      config.chlorineProduct.concentration,
      config.targets.chlorineMinPpm,
      config.targets.chlorineMaxPpm
    );

    return {
      volumeLitersRaw: volumeLiters,
      volumeLiters: toFixedNumber(volumeLiters, 0),
      totalPhMlRaw,
      totalPhMl: toFixedNumber(totalPhMlRaw, 0),
      stage1PhMlRaw,
      stage1PhMl: toFixedNumber(stage1PhMlRaw, 0),
      chlorineMaintenanceMl: toFixedNumber(chlorineDose.maintenanceMl, 0),
      chlorineCorrectiveMl: toFixedNumber(chlorineDose.correctiveMl, 0),
      phStatus: classifyPh(draft.measuredPh!, config),
      chlorineStatus: classifyChlorine(draft.measuredChlorinePpm!, config)
    };
  }, [canGoResults, config, draft.measuredChlorinePpm, draft.measuredPh, draft.waterHeightCm]);

  const phStageInsights = useMemo(() => {
    if (!config || !computed || draft.measuredPh === null) {
      return null;
    }

    const appliedStage1Ml = draft.appliedPhStage1Ml ?? computed.stage1PhMl;
    const estimatedAfterStage1 = estimatePhAfterAcidDose(
      draft.measuredPh,
      appliedStage1Ml,
      computed.volumeLitersRaw,
      config.acidProduct.concentration,
      config.chemistry.estimatedAlkalinityPpm
    );

    if (draft.measuredPhIntermediate === null || !isPhInRange(draft.measuredPhIntermediate)) {
      return {
        appliedStage1Ml,
        estimatedAfterStage1
      };
    }

    const stage2TotalMl = calculatePhCorrectionMl(
      draft.measuredPhIntermediate,
      computed.volumeLitersRaw,
      config.acidProduct.concentration,
      config.targets.phMax,
      config.chemistry.estimatedAlkalinityPpm
    );

    return {
      appliedStage1Ml,
      estimatedAfterStage1,
      stage2TotalMl,
      stage2ConservativeMl: stage2TotalMl * 0.5
    };
  }, [
    computed,
    config,
    draft.appliedPhStage1Ml,
    draft.measuredPh,
    draft.measuredPhIntermediate
  ]);

  const phSensitivity = useMemo(() => {
    if (!config || !computed || draft.measuredPh === null) {
      return null;
    }

    const appliedStage1Ml = draft.appliedPhStage1Ml ?? computed.stage1PhMl;
    const maxDoseMl = Math.max(appliedStage1Ml * 2, computed.totalPhMlRaw * 1.6, 40);
    const pointCount = 11;
    const doses = Array.from({ length: pointCount }, (_, index) => (maxDoseMl * index) / (pointCount - 1));

    const curves = TA_SENSITIVITY_LEVELS.map((taPpm) => ({
      taPpm,
      points: doses.map((doseMl) => ({
        doseMl,
        phValue: estimatePhAfterAcidDose(
          draft.measuredPh!,
          doseMl,
          computed.volumeLitersRaw,
          config.acidProduct.concentration,
          taPpm
        )
      }))
    }));

    return {
      doses,
      maxDoseMl,
      curves
    };
  }, [computed, config, draft.appliedPhStage1Ml, draft.measuredPh]);

  const latest = sessions[0];
  const prioritizeChlorine =
    computed !== null && computed.phStatus === "ok" && computed.chlorineStatus !== "ok";

  useEffect(() => {
    if (!config || loading) {
      return;
    }

    const payload: PersistedUiState = {
      screen,
      draft,
      postDraft
    };

    localStorage.setItem(UI_STATE_KEY, JSON.stringify(payload));
  }, [config, draft, loading, postDraft, screen]);

  function statusTone(value: "ok" | "leve" | "ajuste"): string {
    if (value === "ok") {
      return "status-ok";
    }
    if (value === "leve") {
      return "status-warn";
    }
    return "status-danger";
  }

  function phMarkerStyle(phValue: number): CSSProperties {
    const clamped = Math.min(PH_CHART_MAX, Math.max(PH_CHART_MIN, phValue));
    const left = ((clamped - PH_CHART_MIN) / (PH_CHART_MAX - PH_CHART_MIN)) * 100;
    return { left: `${left}%` };
  }

  async function saveSession(): Promise<void> {
    if (!config || !computed || !canGoResults || saving) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const newSession: Session = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        waterHeightCm: draft.waterHeightCm!,
        measuredPh: draft.measuredPh!,
        measuredPhIntermediate:
          draft.measuredPhIntermediate !== null && isPhInRange(draft.measuredPhIntermediate)
            ? draft.measuredPhIntermediate
            : undefined,
        measuredChlorinePpm: draft.measuredChlorinePpm!,
        calculatedVolumeLiters: computed.volumeLiters,
        requiredPhCorrection: {
          totalMl: computed.totalPhMl,
          stage1Ml: computed.stage1PhMl
        },
        requiredChlorineDose: {
          maintenanceMl: computed.chlorineMaintenanceMl,
          correctiveMl: computed.chlorineCorrectiveMl
        },
        appliedDoses: {
          phStage1Ml: toFixedNumber(draft.appliedPhStage1Ml ?? computed.stage1PhMl, 0),
          chlorineMl: computed.chlorineCorrectiveMl
        },
        postApplicationChecklist: {
          pumpOn: postDraft.pumpOn,
          dilutedCorrectly: postDraft.dilutedCorrectly,
          perimeterApplication: postDraft.perimeterApplication,
          waitRespected: postDraft.waitRespected
        },
        notes: postDraft.notes.trim() || undefined
      };

      await sessionRepo.save(newSession);
      const updatedSessions = await sessionRepo.list();
      setSessions(updatedSessions);
      setScreen("home");
      setPostDraft(defaultPostApplicationDraft);
      localStorage.removeItem(UI_STATE_KEY);
    } catch {
      setError("No se pudo guardar la sesion.");
    } finally {
      setSaving(false);
    }
  }

  function startNewSession(): void {
    setDraft({
      waterHeightCm: null,
      measuredPh: null,
      appliedPhStage1Ml: null,
      measuredPhIntermediate: null,
      measuredChlorinePpm: null
    });
    setError(null);
    setPostDraft(defaultPostApplicationDraft);
    setScreen("new-height");
    localStorage.removeItem(UI_STATE_KEY);
  }

  async function saveSettings(): Promise<void> {
    if (!settingsDraft) {
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

    if (settingsDraft.chemistry.estimatedAlkalinityPpm <= 0) {
      setError("La alcalinidad estimada (TA) debe ser mayor a 0 ppm.");
      return;
    }

    try {
      setError(null);
      await configRepo.save(settingsDraft);
      setConfig(settingsDraft);
      setScreen("home");
    } catch {
      setError("No se pudieron guardar los ajustes.");
    }
  }

  if (loading || !config || !settingsDraft) {
    return <main className="app-shell">Cargando configuracion...</main>;
  }

  return (
    <main className="app-shell">
      <div className="bg-orb bg-orb-a" />
      <div className="bg-orb bg-orb-b" />
      <header className="app-header">
        <p className="app-kicker">Mantenimiento inteligente</p>
        <div className="title-row">
          <img
            className="app-logo"
            src={`${import.meta.env.BASE_URL}icons/icon-128x128.png`}
            alt="Icono Piscina PWA"
          />
          <h1 className="app-title">Piscina PWA</h1>
        </div>
        <p className="app-subtitle">Guia offline para ajustar pH y cloro sin sobrecorrecciones</p>
      </header>

      {error ? <p className="error-text">{error}</p> : null}

      {screen === "home" ? (
        <section className="card">
          <h2 className="section-title">Panel de estado</h2>
          <div className="metrics-grid">
            <article className="metric">
              <p className="metric-label">Diametro</p>
              <p className="metric-value">{config.pool.diameterM} m</p>
            </article>
            <article className="metric">
              <p className="metric-label">Objetivo pH</p>
              <p className="metric-value">
                {config.targets.phMin} - {config.targets.phMax}
              </p>
            </article>
            <article className="metric">
              <p className="metric-label">Objetivo Cloro</p>
              <p className="metric-value">
                {config.targets.chlorineMinPpm} - {config.targets.chlorineMaxPpm} ppm
              </p>
            </article>
            <article className="metric">
              <p className="metric-label">TA estimada</p>
              <p className="metric-value">{config.chemistry.estimatedAlkalinityPpm} ppm</p>
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
            <p>Sin mediciones registradas.</p>
          )}
          <div className="actions">
            <button className="btn-primary" onClick={startNewSession} type="button">
              Nueva medicion
            </button>
            <button className="btn-secondary" onClick={() => setScreen("history")} type="button">
              Historial
            </button>
            <button className="btn-secondary" onClick={() => setScreen("settings")} type="button">
              Ajustes
            </button>
            <button className="btn-secondary" onClick={() => setScreen("help")} type="button">
              Ayuda
            </button>
          </div>
        </section>
      ) : null}

      {screen === "help" ? (
        <section className="card">
          <h2 className="section-title">Ayuda: proceso de mantenimiento</h2>
          <ol className="help-list">
            <li>
              <strong>Medicion inicial:</strong> registra altura del agua, pH y cloro.
            </li>
            <li>
              <strong>Evaluacion:</strong> revisa estado y dosis calculadas para el volumen real.
            </li>
            <li>
              <strong>Doble objetivo para cloro:</strong> la dosis de mantencion apunta al minimo del
              rango; la dosis correctiva apunta al valor central del rango.
            </li>
            <li>
              <strong>pH en doble paso (obligatorio):</strong> aplica solo el 50% en etapa 1, enciende
              bomba, distribuye perimetralmente y espera 30-60 minutos.
            </li>
            <li>
              <strong>Re-medicion pH:</strong> vuelve a medir antes de considerar una segunda etapa.
            </li>
            <li>
              <strong>TA estimada:</strong> el calculo de pH usa alcalinidad estimada (por defecto 100
              ppm). Si sube TA, suele subir la dosis de acido necesaria.
            </li>
            <li>
              <strong>Correccion de cloro:</strong> aplica dosis de mantencion o correctiva segun el
              resultado esperado (minimo o central).
            </li>
            <li>
              <strong>Checklist y notas:</strong> confirma seguridad de aplicacion y guarda observaciones.
            </li>
          </ol>
          <p className="help-highlight">
            Regla de oro: nunca hagas una correccion agresiva de pH en un solo paso, porque el TA real
            puede diferir del estimado y provocar sobrecorreccion.
          </p>
          <p className="inline-note">
            El rango de espera de 30-60 minutos es valido para piscinas de poco volumen (por ejemplo,
            menores a 5 m3) con recirculacion activa.
          </p>
          <div className="actions">
            <button className="btn-primary" onClick={startNewSession} type="button">
              Iniciar nueva medicion
            </button>
            <button className="btn-secondary" onClick={() => setScreen("home")} type="button">
              Volver al inicio
            </button>
          </div>
        </section>
      ) : null}

      {screen === "new-height" ? (
        <section className="card">
          <h2 className="section-title">Nueva sesion: altura de agua</h2>
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
                  waterHeightCm: Number(event.target.value),
                  appliedPhStage1Ml: null,
                  measuredPhIntermediate: null
                }))
              }
            />
          </label>
          <div className="actions">
            <button
              className="btn-primary"
              type="button"
              onClick={() => setScreen("new-ph")}
              disabled={!isHeightInRange(draft.waterHeightCm ?? 0, config.pool.maxHeightCm)}
            >
              Continuar
            </button>
            <button className="btn-secondary" onClick={() => setScreen("home")} type="button">
              Cancelar
            </button>
          </div>
        </section>
      ) : null}

      {screen === "new-ph" ? (
        <section className="card">
          <h2 className="section-title">Nueva sesion: pH</h2>
          <label className="field-label">
            pH medido (6.8 - 8.2)
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
                  measuredPh: Number(event.target.value),
                  appliedPhStage1Ml: null,
                  measuredPhIntermediate: null
                }))
              }
            />
          </label>
          <div className="actions">
            <button
              className="btn-primary"
              type="button"
              onClick={() => setScreen("new-chlorine")}
              disabled={!isPhInRange(draft.measuredPh ?? 0)}
            >
              Continuar
            </button>
            <button className="btn-secondary" onClick={() => setScreen("new-height")} type="button">
              Atras
            </button>
          </div>
        </section>
      ) : null}

      {screen === "new-chlorine" ? (
        <section className="card">
          <h2 className="section-title">Nueva sesion: cloro</h2>
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
                  measuredChlorinePpm: Number(event.target.value)
                }))
              }
            />
          </label>
          <div className="actions">
            <button
              className="btn-primary"
              type="button"
              onClick={() => setScreen("results")}
              disabled={!canGoResults}
            >
              Ver resultados
            </button>
            <button className="btn-secondary" onClick={() => setScreen("new-ph")} type="button">
              Atras
            </button>
          </div>
        </section>
      ) : null}

      {screen === "results" && computed ? (
        <section className="card">
          <h2 className="section-title">Resultados</h2>
          <p>Volumen calculado: {computed.volumeLiters} L</p>
          <div className="status-row">
            <span className={`status-pill ${statusTone(computed.phStatus)}`}>
              pH: {getStatusLabel(computed.phStatus)}
            </span>
            <span className={`status-pill ${statusTone(computed.chlorineStatus)}`}>
              Cloro: {getStatusLabel(computed.chlorineStatus)}
            </span>
          </div>
          <div className="metrics-grid">
            <article className="metric">
              <p className="metric-label">Correccion pH total</p>
              <p className="metric-value">{computed.totalPhMl} ml</p>
            </article>
            <article className="metric">
              <p className="metric-label">Etapa 1 pH (50%)</p>
              <p className="metric-value">{computed.stage1PhMl} ml</p>
            </article>
            <article className="metric">
              <p className="metric-label">Cloro hasta minimo</p>
              <p className="metric-value">{computed.chlorineMaintenanceMl} ml</p>
            </article>
            <article className="metric">
              <p className="metric-label">Cloro correctivo (valor central)</p>
              <p className="metric-value">{computed.chlorineCorrectiveMl} ml</p>
            </article>
          </div>
          <p className="inline-note">
            Mantencion = llegar al minimo del rango. Correctivo = llegar al valor central.
          </p>
          <div className="actions">
            <button
              className={prioritizeChlorine ? "btn-secondary" : "btn-primary"}
              onClick={() => setScreen("ph-stage1")}
              type="button"
            >
              {computed.phStatus === "ok" ? "Guia pH (opcional)" : "Guia pH etapa 1"}
            </button>
            <button
              className={prioritizeChlorine ? "btn-primary" : "btn-secondary"}
              onClick={() => setScreen("chlorine-correction")}
              type="button"
            >
              Guia cloro
            </button>
            <button className="btn-secondary" onClick={() => setScreen("new-chlorine")} type="button">
              Atras
            </button>
          </div>
        </section>
      ) : null}

      {screen === "ph-stage1" && computed ? (
        <section className="card">
          <h2 className="section-title">pH - Etapa 1</h2>
          <p>Aplicar {computed.stage1PhMl} ml de acido muriatico (50% del total).</p>
          <ul className="bullet-list">
            <li>Encender bomba.</li>
            <li>Diluir quimico antes de aplicar.</li>
            <li>Aplicar en forma perimetral.</li>
          </ul>
          <div className="actions">
            <button
              className="btn-primary"
              onClick={() => {
                setDraft((prev) => ({
                  ...prev,
                  appliedPhStage1Ml: prev.appliedPhStage1Ml ?? computed.stage1PhMl
                }));
                setScreen("wait");
              }}
              type="button"
            >
              Ir a espera
            </button>
            <button className="btn-secondary" onClick={() => setScreen("results")} type="button">
              Atras
            </button>
          </div>
        </section>
      ) : null}

      {screen === "wait" && computed && phStageInsights ? (
        <section className="card">
          <h2 className="section-title">Esperar 30-60 minutos</h2>
          <p>Luego repetir medicion de pH antes de la etapa 2.</p>
          <p className="inline-note">
            Referencia: este rango aplica a piscinas de poco volumen (por ejemplo, &lt; 5 m3).
          </p>
          <label className="field-label">
            Dosis aplicada en etapa 1 (ml)
            <input
              className="field-input"
              type="number"
              min={0}
              step={1}
              value={draft.appliedPhStage1Ml ?? computed.stage1PhMl}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, appliedPhStage1Ml: Number(event.target.value) }))
              }
            />
          </label>
          <div className="ph-chart-wrap" aria-label="Grafico de impacto pH etapa 1">
            <h3 className="chart-title">Grafico 1: Impacto estimado de la etapa 1</h3>
            <p className="chart-subtitle">
              Eje X: pH. Compara pH inicial, pH estimado tras la dosis aplicada y pH intermedio medido.
            </p>
            <div className="ph-chart">
              <div
                className="ph-target-band"
                style={{
                  left: `${((config.targets.phMin - PH_CHART_MIN) / (PH_CHART_MAX - PH_CHART_MIN)) * 100}%`,
                  width: `${((config.targets.phMax - config.targets.phMin) / (PH_CHART_MAX - PH_CHART_MIN)) * 100}%`
                }}
              />
              <span className="ph-marker ph-marker-start" style={phMarkerStyle(draft.measuredPh!)}>
                <span className="ph-marker-label">Inicial {toFixedNumber(draft.measuredPh!, 2)}</span>
              </span>
              <span
                className="ph-marker ph-marker-estimated"
                style={phMarkerStyle(phStageInsights.estimatedAfterStage1)}
              >
                <span className="ph-marker-label">
                  Estimado {toFixedNumber(phStageInsights.estimatedAfterStage1, 2)}
                </span>
              </span>
              {draft.measuredPhIntermediate !== null && isPhInRange(draft.measuredPhIntermediate) ? (
                <span
                  className="ph-marker ph-marker-measured"
                  style={phMarkerStyle(draft.measuredPhIntermediate)}
                >
                  <span className="ph-marker-label">
                    Medido {toFixedNumber(draft.measuredPhIntermediate, 2)}
                  </span>
                </span>
              ) : null}
            </div>
            <div className="ph-chart-scale">
              <span>{PH_CHART_MIN}</span>
              <span>{config.targets.phMin}</span>
              <span>{config.targets.phMax}</span>
              <span>{PH_CHART_MAX}</span>
            </div>
            <p className="axis-label">Eje X (pH)</p>
          </div>
          {phSensitivity ? (
            <div className="ph-chart-wrap" aria-label="Grafico de sensibilidad de pH por TA">
              <h3 className="chart-title">Grafico 2: Sensibilidad por TA estimada</h3>
              <p className="chart-subtitle">
                Eje X: dosis de HCl (ml). Eje Y: pH resultante estimado. Cada curva usa un TA distinto.
              </p>
              <svg className="ta-sensitivity-chart" viewBox="0 0 360 220" role="img">
                <title>Curvas de pH estimado segun dosis de HCl y TA</title>
                <line className="axis-line" x1="44" y1="16" x2="44" y2="186" />
                <line className="axis-line" x1="44" y1="186" x2="344" y2="186" />
                <line
                  className="target-line"
                  x1="44"
                  y1={16 + ((PH_CHART_MAX - config.targets.phMax) / (PH_CHART_MAX - PH_CHART_MIN)) * 170}
                  x2="344"
                  y2={16 + ((PH_CHART_MAX - config.targets.phMax) / (PH_CHART_MAX - PH_CHART_MIN)) * 170}
                />
                <line
                  className="target-line"
                  x1="44"
                  y1={16 + ((PH_CHART_MAX - config.targets.phMin) / (PH_CHART_MAX - PH_CHART_MIN)) * 170}
                  x2="344"
                  y2={16 + ((PH_CHART_MAX - config.targets.phMin) / (PH_CHART_MAX - PH_CHART_MIN)) * 170}
                />
                <text className="axis-text" x="6" y="18">
                  {PH_CHART_MAX}
                </text>
                <text
                  className="axis-text"
                  x="6"
                  y={21 + ((PH_CHART_MAX - config.targets.phMax) / (PH_CHART_MAX - PH_CHART_MIN)) * 170}
                >
                  {config.targets.phMax}
                </text>
                <text
                  className="axis-text"
                  x="6"
                  y={21 + ((PH_CHART_MAX - config.targets.phMin) / (PH_CHART_MAX - PH_CHART_MIN)) * 170}
                >
                  {config.targets.phMin}
                </text>
                <text className="axis-text" x="6" y="190">
                  {PH_CHART_MIN}
                </text>
                {phSensitivity.curves.map((curve, curveIndex) => {
                  const color = ["#1e88e5", "#00acc1", "#43a047", "#fb8c00", "#8e24aa"][curveIndex];
                  const points = curve.points
                    .map((point) => {
                      const x = 44 + (point.doseMl / phSensitivity.maxDoseMl) * 300;
                      const clampedPh = Math.min(PH_CHART_MAX, Math.max(PH_CHART_MIN, point.phValue));
                      const y = 16 + ((PH_CHART_MAX - clampedPh) / (PH_CHART_MAX - PH_CHART_MIN)) * 170;
                      return `${x.toFixed(2)},${y.toFixed(2)}`;
                    })
                    .join(" ");

                  return <polyline key={curve.taPpm} className="ta-curve" points={points} style={{ color }} />;
                })}
                <text className="axis-text" x="44" y="205">
                  0
                </text>
                <text className="axis-text" x="302" y="205">
                  {toFixedNumber(phSensitivity.maxDoseMl, 0)} ml
                </text>
              </svg>
              <p className="axis-label">Eje Y (pH resultante) vs Eje X (dosis HCl, ml)</p>
              <div className="chart-legend">
                {phSensitivity.curves.map((curve, curveIndex) => {
                  const color = ["#1e88e5", "#00acc1", "#43a047", "#fb8c00", "#8e24aa"][curveIndex];
                  return (
                    <span key={curve.taPpm} className="legend-item">
                      <span className="legend-swatch" style={{ backgroundColor: color }} />
                      TA {curve.taPpm} ppm
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}
          <label className="field-label">
            pH intermedio (opcional)
            <input
              className="field-input"
              type="number"
              min={6.8}
              max={8.2}
              step={0.1}
              value={draft.measuredPhIntermediate ?? ""}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  measuredPhIntermediate:
                    event.target.value === "" ? null : Number(event.target.value)
                }))
              }
              placeholder="Ejemplo: 7.4"
            />
          </label>
          {draft.measuredPhIntermediate !== null && !isPhInRange(draft.measuredPhIntermediate) ? (
            <p className="error-text">El pH intermedio debe estar entre 6.8 y 8.2.</p>
          ) : null}
          {typeof phStageInsights.stage2TotalMl === "number" ? (
            <div className="metrics-grid">
              <article className="metric">
                <p className="metric-label">Etapa 2 directa (si fuese necesaria)</p>
                <p className="metric-value">{toFixedNumber(phStageInsights.stage2TotalMl, 0)} ml</p>
              </article>
              <article className="metric">
                <p className="metric-label">Etapa 2 conservadora (50%)</p>
                <p className="metric-value">
                  {toFixedNumber(phStageInsights.stage2ConservativeMl ?? 0, 0)} ml
                </p>
              </article>
            </div>
          ) : null}
          <div className="actions">
            <button className="btn-primary" onClick={() => setScreen("chlorine-correction")} type="button">
              Continuar con cloro
            </button>
            <button className="btn-secondary" onClick={() => setScreen("home")} type="button">
              Volver al inicio
            </button>
          </div>
        </section>
      ) : null}

      {screen === "chlorine-correction" && computed ? (
        <section className="card">
          <h2 className="section-title">Correccion de cloro</h2>
          <p>Dosis de mantencion (hasta minimo): {computed.chlorineMaintenanceMl} ml</p>
          <p>Dosis correctiva (hasta valor central): {computed.chlorineCorrectiveMl} ml</p>
          <ul className="bullet-list">
            <li>Bomba encendida.</li>
            <li>Dilucion previa.</li>
            <li>Aplicacion perimetral.</li>
            <li>Respetar tiempo de espera.</li>
          </ul>
          <div className="actions">
            <button className="btn-primary" onClick={() => setScreen("post-checklist")} type="button">
              Continuar
            </button>
            <button className="btn-secondary" onClick={() => setScreen("home")} type="button">
              Volver
            </button>
          </div>
          <p className="inline-note">No se guardara la sesion si vuelves al inicio.</p>
        </section>
      ) : null}

      {screen === "post-checklist" ? (
        <section className="card">
          <h2 className="section-title">Checklist post-aplicacion</h2>
          <label className="check-item">
            <input
              type="checkbox"
              checked={postDraft.pumpOn}
              onChange={(event) =>
                setPostDraft((prev) => ({ ...prev, pumpOn: event.target.checked }))
              }
            />
            Bomba encendida
          </label>
          <label className="check-item">
            <input
              type="checkbox"
              checked={postDraft.dilutedCorrectly}
              onChange={(event) =>
                setPostDraft((prev) => ({ ...prev, dilutedCorrectly: event.target.checked }))
              }
            />
            Quimicos diluidos correctamente
          </label>
          <label className="check-item">
            <input
              type="checkbox"
              checked={postDraft.perimeterApplication}
              onChange={(event) =>
                setPostDraft((prev) => ({ ...prev, perimeterApplication: event.target.checked }))
              }
            />
            Aplicacion perimetral
          </label>
          <label className="check-item">
            <input
              type="checkbox"
              checked={postDraft.waitRespected}
              onChange={(event) =>
                setPostDraft((prev) => ({ ...prev, waitRespected: event.target.checked }))
              }
            />
            Tiempo de espera respetado
          </label>
          <label className="field-label">
            Notas de la sesion
            <textarea
              className="field-input textarea-input"
              value={postDraft.notes}
              onChange={(event) => setPostDraft((prev) => ({ ...prev, notes: event.target.value }))}
              placeholder="Observaciones opcionales"
              rows={4}
            />
          </label>
          <div className="actions">
            <button className="btn-primary" onClick={() => void saveSession()} disabled={saving} type="button">
              {saving ? "Guardando..." : "Guardar sesion"}
            </button>
            <button className="btn-secondary" onClick={() => setScreen("chlorine-correction")} type="button">
              Atras
            </button>
          </div>
        </section>
      ) : null}

      {screen === "history" ? (
        <section className="card">
          <h2 className="section-title">Historial</h2>
          {sessions.length === 0 ? <p>No hay sesiones.</p> : null}
          {sessions.map((session) => (
            <article key={session.id} className="history-item">
              <p>{new Date(session.timestamp).toLocaleString()}</p>
              <p>
                Altura {session.waterHeightCm} cm | pH {session.measuredPh} | Cl{" "}
                {session.measuredChlorinePpm} ppm
              </p>
              {typeof session.measuredPhIntermediate === "number" ? (
                <p>pH intermedio: {session.measuredPhIntermediate}</p>
              ) : null}
              <p>
                pH etapa 1: {session.requiredPhCorrection.stage1Ml} ml | Cloro:{" "}
                {session.requiredChlorineDose.correctiveMl} ml
              </p>
              {session.notes ? <p>Notas: {session.notes}</p> : null}
            </article>
          ))}
          <div className="actions">
            <button className="btn-secondary" onClick={() => setScreen("home")} type="button">
              Volver
            </button>
          </div>
        </section>
      ) : null}

      {screen === "settings" ? (
        <section className="card">
          <h2 className="section-title">Ajustes</h2>
          <label className="field-label">
            Diametro (m)
            <input
              className="field-input"
              type="number"
              step={0.01}
              min={1}
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
            Cloro %
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
            Acido muriatico %
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
          <label className="field-label">
            Alcalinidad estimada TA (ppm)
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
            pH objetivo minimo
            <input
              className="field-input"
              type="number"
              step={0.1}
              min={6.8}
              max={8.2}
              value={settingsDraft.targets.phMin}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        targets: { ...prev.targets, phMin: Number(event.target.value) }
                      }
                    : prev
                )
              }
            />
          </label>
          <label className="field-label">
            pH objetivo maximo
            <input
              className="field-input"
              type="number"
              step={0.1}
              min={6.8}
              max={8.2}
              value={settingsDraft.targets.phMax}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        targets: { ...prev.targets, phMax: Number(event.target.value) }
                      }
                    : prev
                )
              }
            />
          </label>
          <label className="field-label">
            Cloro objetivo minimo (ppm)
            <input
              className="field-input"
              type="number"
              step={0.1}
              min={0}
              max={10}
              value={settingsDraft.targets.chlorineMinPpm}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        targets: { ...prev.targets, chlorineMinPpm: Number(event.target.value) }
                      }
                    : prev
                )
              }
            />
          </label>
          <label className="field-label">
            Cloro objetivo maximo (ppm)
            <input
              className="field-input"
              type="number"
              step={0.1}
              min={0}
              max={10}
              value={settingsDraft.targets.chlorineMaxPpm}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        targets: { ...prev.targets, chlorineMaxPpm: Number(event.target.value) }
                      }
                    : prev
                )
              }
            />
          </label>
          <div className="actions">
            <button className="btn-primary" onClick={() => void saveSettings()} type="button">
              Guardar
            </button>
            <button className="btn-secondary" onClick={() => setScreen("home")} type="button">
              Cancelar
            </button>
          </div>
        </section>
      ) : null}

      {screen !== "home" ? (
        <nav className="quick-nav" aria-label="Atajos">
          <button className="chip-btn" onClick={() => setScreen("home")} type="button">
            Inicio
          </button>
          <button className="chip-btn" onClick={() => setScreen("help")} type="button">
            Ayuda
          </button>
          <button className="chip-btn" onClick={() => setScreen("history")} type="button">
            Historial
          </button>
        </nav>
      ) : null}
    </main>
  );
}
