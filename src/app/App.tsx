import { useEffect, useMemo, useState } from "react";
import { configRepo } from "../data/repositories/configRepo";
import { sessionRepo } from "../data/repositories/sessionRepo";
import {
  calculateChlorineDoseMl,
  calculatePhCorrectionMl,
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
import type { PoolConfig, Session } from "../domain/types";
import "./App.css";

type Screen =
  | "home"
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
  measuredChlorinePpm: number | null;
}

interface PostApplicationDraft {
  pumpOn: boolean;
  dilutedCorrectly: boolean;
  perimeterApplication: boolean;
  waitRespected: boolean;
  notes: string;
}

const defaultPostApplicationDraft: PostApplicationDraft = {
  pumpOn: false,
  dilutedCorrectly: false,
  perimeterApplication: false,
  waitRespected: false,
  notes: ""
};

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
    measuredChlorinePpm: null
  });
  const [postDraft, setPostDraft] = useState<PostApplicationDraft>(defaultPostApplicationDraft);
  const [settingsDraft, setSettingsDraft] = useState<PoolConfig | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const loaded = await configRepo.load();
        const nextConfig = loaded ?? defaultPoolConfig;

        if (!loaded) {
          await configRepo.save(defaultPoolConfig);
        }

        const loadedSessions = await sessionRepo.list();
        setConfig(nextConfig);
        setSettingsDraft(nextConfig);
        setSessions(loadedSessions);
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
    const totalPhMl = calculatePhCorrectionMl(draft.measuredPh!, volumeLiters);
    const chlorineDose = calculateChlorineDoseMl(
      draft.measuredChlorinePpm!,
      volumeLiters,
      config.chlorineProduct.concentration,
      config.targets.chlorineMinPpm
    );

    return {
      volumeLiters: toFixedNumber(volumeLiters, 0),
      totalPhMl: toFixedNumber(totalPhMl, 0),
      stage1PhMl: toFixedNumber(totalPhMl * 0.5, 0),
      chlorineMaintenanceMl: toFixedNumber(chlorineDose.maintenanceMl, 0),
      chlorineCorrectiveMl: toFixedNumber(chlorineDose.correctiveMl, 0),
      phStatus: classifyPh(draft.measuredPh!, config),
      chlorineStatus: classifyChlorine(draft.measuredChlorinePpm!, config)
    };
  }, [canGoResults, config, draft.measuredChlorinePpm, draft.measuredPh, draft.waterHeightCm]);

  const latest = sessions[0];

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
          phStage1Ml: computed.stage1PhMl,
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
      measuredChlorinePpm: null
    });
    setError(null);
    setPostDraft(defaultPostApplicationDraft);
    setScreen("new-height");
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
      <header className="app-header">
        <h1 className="app-title">Piscina PWA</h1>
        <p className="app-subtitle">Asistente offline para mantenimiento quimico</p>
      </header>

      {error ? <p className="error-text">{error}</p> : null}

      {screen === "home" ? (
        <section className="card">
          <h2 className="section-title">Estado</h2>
          <p>Diametro: {config.pool.diameterM} m</p>
          <p>
            Objetivo pH: {config.targets.phMin} - {config.targets.phMax}
          </p>
          <p>
            Cloro objetivo: {config.targets.chlorineMinPpm} - {config.targets.chlorineMaxPpm} ppm
          </p>
          {latest ? (
            <p>
              Ultima medicion: {new Date(latest.timestamp).toLocaleString()} (pH {latest.measuredPh},
              Cl {latest.measuredChlorinePpm} ppm)
            </p>
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
                setDraft((prev) => ({ ...prev, waterHeightCm: Number(event.target.value) }))
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
                setDraft((prev) => ({ ...prev, measuredPh: Number(event.target.value) }))
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
          <p>Estado pH: {getStatusLabel(computed.phStatus)}</p>
          <p>Estado cloro: {getStatusLabel(computed.chlorineStatus)}</p>
          <p>Correccion pH total: {computed.totalPhMl} ml</p>
          <p>Etapa 1 pH (50%): {computed.stage1PhMl} ml</p>
          <p>Cloro mantencion: {computed.chlorineMaintenanceMl} ml</p>
          <p>Cloro correctivo: {computed.chlorineCorrectiveMl} ml</p>
          <div className="actions">
            <button className="btn-primary" onClick={() => setScreen("ph-stage1")} type="button">
              Guia pH etapa 1
            </button>
            <button className="btn-secondary" onClick={() => setScreen("chlorine-correction")} type="button">
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
            <button className="btn-primary" onClick={() => setScreen("wait")} type="button">
              Ir a espera
            </button>
            <button className="btn-secondary" onClick={() => setScreen("results")} type="button">
              Atras
            </button>
          </div>
        </section>
      ) : null}

      {screen === "wait" ? (
        <section className="card">
          <h2 className="section-title">Esperar 4-6 horas</h2>
          <p>Luego repetir medicion de pH antes de la etapa 2.</p>
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
          <p>Dosis de mantencion: {computed.chlorineMaintenanceMl} ml</p>
          <p>Dosis correctiva: {computed.chlorineCorrectiveMl} ml</p>
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
              Finalizar
            </button>
          </div>
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
    </main>
  );
}
