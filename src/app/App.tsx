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
import type { CheckMoment, PoolConfig, Session } from "../domain/types";
import "./App.css";

type Screen =
  | "home"
  | "startup"
  | "help"
  | "new-height"
  | "new-ph"
  | "new-chlorine"
  | "quick-check"
  | "results"
  | "ph-stage1"
  | "wait"
  | "chlorine-correction"
  | "post-checklist"
  | "history"
  | "settings";

type ReminderMinutes = 30 | 45 | 60;

interface DraftSessionInput {
  waterHeightCm: number | null;
  measuredPh: number | null;
  appliedPhStage1Ml: number | null;
  measuredPhIntermediate: number | null;
  measuredChlorinePpm: number | null;
  waitReminderMinutes: ReminderMinutes;
  stage1AppliedAtIso: string | null;
  waitReminderNotified: boolean;
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
  quickCheckDraft?: QuickCheckDraft;
}

interface StartupDraft {
  mode: "basic" | "advanced";
  measuredPh: number | null;
  measuredChlorinePpm: number | null;
  measuredTaPpm: number | null;
  measuredCyaPpm: number | null;
  measuredCombinedChlorinePpm: number | null;
  waterLooksCloudy: boolean;
  notes: string;
  completedAtIso: string | null;
}

interface QuickCheckDraft {
  waterHeightCm: number | null;
  measuredPh: number | null;
  measuredChlorinePpm: number | null;
  moment: CheckMoment;
  notes: string;
}

const defaultPostApplicationDraft: PostApplicationDraft = {
  pumpOn: false,
  dilutedCorrectly: false,
  perimeterApplication: false,
  waitRespected: false,
  notes: ""
};

const UI_STATE_KEY = "piscina-ui-state-v1";
const STARTUP_STATE_KEY = "piscina-startup-state-v1";
const PH_CHART_MIN = 6.8;
const PH_CHART_MAX = 8.2;
const TA_SENSITIVITY_LEVELS = [60, 80, 100, 120, 140];
const REMINDER_OPTIONS: ReminderMinutes[] = [30, 45, 60];
const DEFAULT_REMINDER_MINUTES: ReminderMinutes = 45;
const PH_MARKER_MIN_GAP_PCT = 8;
const HIGH_DAYLIGHT_LOSS_PPM = 1.0;
const SESSION_FLOW_SCREENS: Screen[] = [
  "results",
  "ph-stage1",
  "wait",
  "chlorine-correction",
  "post-checklist"
];

function createDefaultDraft(): DraftSessionInput {
  return {
    waterHeightCm: null,
    measuredPh: null,
    appliedPhStage1Ml: null,
    measuredPhIntermediate: null,
    measuredChlorinePpm: null,
    waitReminderMinutes: DEFAULT_REMINDER_MINUTES,
    stage1AppliedAtIso: null,
    waitReminderNotified: false
  };
}

function createDefaultStartupDraft(): StartupDraft {
  return {
    mode: "basic",
    measuredPh: null,
    measuredChlorinePpm: null,
    measuredTaPpm: null,
    measuredCyaPpm: null,
    measuredCombinedChlorinePpm: null,
    waterLooksCloudy: false,
    notes: "",
    completedAtIso: null
  };
}

function createDefaultQuickCheckDraft(): QuickCheckDraft {
  return {
    waterHeightCm: null,
    measuredPh: null,
    measuredChlorinePpm: null,
    moment: "start-day",
    notes: ""
  };
}

function getLocalDateKey(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseReminderMinutes(value: unknown): ReminderMinutes {
  if (value === 30 || value === 45 || value === 60) {
    return value;
  }
  return DEFAULT_REMINDER_MINUTES;
}

function isScreen(value: unknown): value is Screen {
  if (typeof value !== "string") {
    return false;
  }

  return (
    value === "home" ||
    value === "startup" ||
    value === "help" ||
    value === "new-height" ||
    value === "new-ph" ||
    value === "new-chlorine" ||
    value === "quick-check" ||
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
  const [draft, setDraft] = useState<DraftSessionInput>(createDefaultDraft);
  const [postDraft, setPostDraft] = useState<PostApplicationDraft>(defaultPostApplicationDraft);
  const [startupDraft, setStartupDraft] = useState<StartupDraft>(createDefaultStartupDraft);
  const [quickCheckDraft, setQuickCheckDraft] = useState<QuickCheckDraft>(createDefaultQuickCheckDraft);
  const [settingsDraft, setSettingsDraft] = useState<PoolConfig | null>(null);
  const [reminderMessage, setReminderMessage] = useState<string | null>(null);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());

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
          const rawStartup = localStorage.getItem(STARTUP_STATE_KEY);
          if (rawStartup) {
            const restoredStartup = JSON.parse(rawStartup) as Partial<StartupDraft>;
            setStartupDraft((prev) => ({
              ...prev,
              mode: restoredStartup.mode === "advanced" ? "advanced" : "basic",
              measuredPh:
                typeof restoredStartup.measuredPh === "number" ? restoredStartup.measuredPh : null,
              measuredChlorinePpm:
                typeof restoredStartup.measuredChlorinePpm === "number"
                  ? restoredStartup.measuredChlorinePpm
                  : null,
              measuredTaPpm:
                typeof restoredStartup.measuredTaPpm === "number"
                  ? restoredStartup.measuredTaPpm
                  : null,
              measuredCyaPpm:
                typeof restoredStartup.measuredCyaPpm === "number"
                  ? restoredStartup.measuredCyaPpm
                  : null,
              measuredCombinedChlorinePpm:
                typeof restoredStartup.measuredCombinedChlorinePpm === "number"
                  ? restoredStartup.measuredCombinedChlorinePpm
                  : null,
              waterLooksCloudy: Boolean(restoredStartup.waterLooksCloudy),
              notes: typeof restoredStartup.notes === "string" ? restoredStartup.notes : "",
              completedAtIso:
                typeof restoredStartup.completedAtIso === "string"
                  ? restoredStartup.completedAtIso
                  : null
            }));
          }
        } catch {
          localStorage.removeItem(STARTUP_STATE_KEY);
        }

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
            ...createDefaultDraft(),
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
                : null,
            waitReminderMinutes: parseReminderMinutes(restored.draft?.waitReminderMinutes),
            stage1AppliedAtIso:
              typeof restored.draft?.stage1AppliedAtIso === "string"
                ? restored.draft.stage1AppliedAtIso
                : null,
            waitReminderNotified: Boolean(restored.draft?.waitReminderNotified)
          };

          const restoredPostDraft: PostApplicationDraft = {
            pumpOn: Boolean(restored.postDraft?.pumpOn),
            dilutedCorrectly: Boolean(restored.postDraft?.dilutedCorrectly),
            perimeterApplication: Boolean(restored.postDraft?.perimeterApplication),
            waitRespected: Boolean(restored.postDraft?.waitRespected),
            notes: typeof restored.postDraft?.notes === "string" ? restored.postDraft.notes : ""
          };
          const restoredQuickCheckDraft: QuickCheckDraft = {
            ...createDefaultQuickCheckDraft(),
            waterHeightCm:
              typeof restored.quickCheckDraft?.waterHeightCm === "number"
                ? restored.quickCheckDraft.waterHeightCm
                : null,
            measuredPh:
              typeof restored.quickCheckDraft?.measuredPh === "number"
                ? restored.quickCheckDraft.measuredPh
                : null,
            measuredChlorinePpm:
              typeof restored.quickCheckDraft?.measuredChlorinePpm === "number"
                ? restored.quickCheckDraft.measuredChlorinePpm
                : null,
            moment:
              restored.quickCheckDraft?.moment === "sun-hours" ||
              restored.quickCheckDraft?.moment === "night" ||
              restored.quickCheckDraft?.moment === "start-day"
                ? restored.quickCheckDraft.moment
                : "start-day",
            notes:
              typeof restored.quickCheckDraft?.notes === "string"
                ? restored.quickCheckDraft.notes
                : ""
          };

          setDraft(restoredDraft);
          setPostDraft(restoredPostDraft);
          setQuickCheckDraft(restoredQuickCheckDraft);

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
    const maxDoseMl = computed.totalPhMlRaw;
    if (maxDoseMl <= 0) {
      return null;
    }
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
      stage1DoseMl: Math.max(0, Math.min(appliedStage1Ml, maxDoseMl)),
      curves
    };
  }, [computed, config, draft.appliedPhStage1Ml, draft.measuredPh]);

  const latest = sessions[0];
  const prioritizeChlorine =
    computed !== null && computed.phStatus === "ok" && computed.chlorineStatus !== "ok";
  const startupNeedsAttention = startupDraft.completedAtIso === null;
  const startupShockSuggested =
    startupDraft.waterLooksCloudy ||
    (typeof startupDraft.measuredChlorinePpm === "number" &&
      startupDraft.measuredChlorinePpm < (config?.targets.chlorineMinPpm ?? 1)) ||
    (typeof startupDraft.measuredCombinedChlorinePpm === "number" &&
      startupDraft.measuredCombinedChlorinePpm >= 0.5);

  const chlorineLossStats = useMemo(() => {
    const checks = sessions
      .filter(
        (session): session is Session & { kind: "check"; checkMoment: CheckMoment } =>
          session.kind === "check" &&
          (session.checkMoment === "start-day" ||
            session.checkMoment === "sun-hours" ||
            session.checkMoment === "night")
      )
      .slice()
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    const overnightLosses: number[] = [];
    const daylightLosses: number[] = [];

    for (let index = 1; index < checks.length; index += 1) {
      const previous = checks[index - 1];
      const current = checks[index];
      const delta = previous.measuredChlorinePpm - current.measuredChlorinePpm;

      if (previous.checkMoment === "night" && current.checkMoment === "start-day") {
        overnightLosses.push(delta);
      }

      if (previous.checkMoment === "start-day" && current.checkMoment === "sun-hours") {
        daylightLosses.push(delta);
      }
    }

    const lastOvernight = overnightLosses.length > 0 ? overnightLosses[overnightLosses.length - 1] : null;
    const lastDaylight = daylightLosses.length > 0 ? daylightLosses[daylightLosses.length - 1] : null;
    const avgOvernight =
      overnightLosses.length > 0
        ? overnightLosses.reduce((sum, value) => sum + value, 0) / overnightLosses.length
        : null;
    const avgDaylight =
      daylightLosses.length > 0
        ? daylightLosses.reduce((sum, value) => sum + value, 0) / daylightLosses.length
        : null;

    return {
      overnightCount: overnightLosses.length,
      daylightCount: daylightLosses.length,
      lastOvernight,
      lastDaylight,
      avgOvernight,
      avgDaylight
    };
  }, [sessions]);
  const fcTrend = useMemo(() => {
    const checks = sessions
      .filter(
        (session): session is Session & { kind: "check"; checkMoment: CheckMoment } =>
          session.kind === "check" &&
          (session.checkMoment === "start-day" ||
            session.checkMoment === "sun-hours" ||
            session.checkMoment === "night")
      )
      .slice()
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    const byDay = new Map<
      string,
      { label: string; startDay: number | null; sunHours: number | null; night: number | null }
    >();

    for (const check of checks) {
      const key = getLocalDateKey(check.timestamp);
      if (!key) {
        continue;
      }

      const day = byDay.get(key) ?? {
        label: key.slice(5),
        startDay: null,
        sunHours: null,
        night: null
      };

      if (check.checkMoment === "start-day") {
        day.startDay = check.measuredChlorinePpm;
      } else if (check.checkMoment === "sun-hours") {
        day.sunHours = check.measuredChlorinePpm;
      } else if (check.checkMoment === "night") {
        day.night = check.measuredChlorinePpm;
      }

      byDay.set(key, day);
    }

    const days = [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-7)
      .map(([, value]) => value);

    return {
      days,
      hasData: days.some((day) => day.startDay !== null || day.sunHours !== null || day.night !== null)
    };
  }, [sessions]);

  const highDaylightLoss =
    (typeof chlorineLossStats.avgDaylight === "number" &&
      chlorineLossStats.avgDaylight >= HIGH_DAYLIGHT_LOSS_PPM) ||
    (typeof chlorineLossStats.lastDaylight === "number" &&
      chlorineLossStats.lastDaylight >= HIGH_DAYLIGHT_LOSS_PPM);
  const lowCyaDetected =
    typeof startupDraft.measuredCyaPpm === "number" && startupDraft.measuredCyaPpm < 30;
  const coverAbsent = config?.chemistry.usesCover === false;
  const daylightLossRiskAlert = highDaylightLoss && (lowCyaDetected || coverAbsent);

  const waitReminderDueMs = useMemo(() => {
    if (!draft.stage1AppliedAtIso) {
      return null;
    }

    const stage1AtMs = Date.parse(draft.stage1AppliedAtIso);
    if (!Number.isFinite(stage1AtMs)) {
      return null;
    }

    return stage1AtMs + draft.waitReminderMinutes * 60_000;
  }, [draft.stage1AppliedAtIso, draft.waitReminderMinutes]);

  const waitReminderRemainingMs =
    waitReminderDueMs === null ? null : Math.max(0, waitReminderDueMs - clockNowMs);

  const waitChartMarkers = useMemo(() => {
    if (!phStageInsights || draft.measuredPh === null) {
      return [];
    }

    const markers: Array<{ key: string; className: string; label: string; phValue: number }> = [
      {
        key: "initial",
        className: "ph-marker-start",
        label: `Inicial ${toFixedNumber(draft.measuredPh, 2)}`,
        phValue: draft.measuredPh
      },
      {
        key: "estimated-stage1",
        className: "ph-marker-estimated",
        label: `Estimado etapa 1 ${toFixedNumber(phStageInsights.estimatedAfterStage1, 2)}`,
        phValue: phStageInsights.estimatedAfterStage1
      }
    ];

    if (draft.measuredPhIntermediate !== null && isPhInRange(draft.measuredPhIntermediate)) {
      markers.push({
        key: "intermediate",
        className: "ph-marker-measured",
        label: `Medido ${toFixedNumber(draft.measuredPhIntermediate, 2)}`,
        phValue: draft.measuredPhIntermediate
      });
    }

    const positioned = markers
      .map((marker) => ({
        ...marker,
        leftPct: ((Math.min(PH_CHART_MAX, Math.max(PH_CHART_MIN, marker.phValue)) - PH_CHART_MIN) /
          (PH_CHART_MAX - PH_CHART_MIN)) *
          100
      }))
      .sort((a, b) => a.leftPct - b.leftPct);

    const laneLastLeft: number[] = [];
    return positioned.map((marker) => {
      let lane = 0;
      while (
        typeof laneLastLeft[lane] === "number" &&
        marker.leftPct - laneLastLeft[lane] < PH_MARKER_MIN_GAP_PCT
      ) {
        lane += 1;
      }
      laneLastLeft[lane] = marker.leftPct;

      return {
        ...marker,
        lane
      };
    });
  }, [draft.measuredPh, draft.measuredPhIntermediate, phStageInsights]);

  useEffect(() => {
    if (screen !== "wait" || waitReminderDueMs === null || draft.waitReminderNotified) {
      return;
    }

    const timerMs = waitReminderDueMs - Date.now();

    const notifyReminder = () => {
      const title = "Piscina PWA";
      const body = `Pasaron ${draft.waitReminderMinutes} minutos. Repite la medicion de pH antes de la etapa 2.`;

      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body });
      } else {
        window.alert(body);
      }

      setReminderMessage(body);
      setDraft((prev) =>
        prev.waitReminderNotified
          ? prev
          : {
              ...prev,
              waitReminderNotified: true
            }
      );
    };

    if (timerMs <= 0) {
      notifyReminder();
      return;
    }

    const timeoutId = window.setTimeout(notifyReminder, timerMs);
    return () => window.clearTimeout(timeoutId);
  }, [draft.waitReminderMinutes, draft.waitReminderNotified, screen, waitReminderDueMs]);

  useEffect(() => {
    if (screen !== "wait" || waitReminderDueMs === null || draft.waitReminderNotified) {
      return;
    }

    setClockNowMs(Date.now());
    const intervalId = window.setInterval(() => setClockNowMs(Date.now()), 15_000);
    return () => window.clearInterval(intervalId);
  }, [draft.waitReminderNotified, screen, waitReminderDueMs]);

  useEffect(() => {
    if (!config || loading) {
      return;
    }

    const payload: PersistedUiState = {
      screen,
      draft,
      postDraft,
      quickCheckDraft
    };

    localStorage.setItem(UI_STATE_KEY, JSON.stringify(payload));
  }, [config, draft, loading, postDraft, quickCheckDraft, screen]);

  useEffect(() => {
    localStorage.setItem(STARTUP_STATE_KEY, JSON.stringify(startupDraft));
  }, [startupDraft]);

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

  function phScaleTickStyle(phValue: number, edge: "start" | "middle" | "end"): CSSProperties {
    const clamped = Math.min(PH_CHART_MAX, Math.max(PH_CHART_MIN, phValue));
    const left = ((clamped - PH_CHART_MIN) / (PH_CHART_MAX - PH_CHART_MIN)) * 100;
    return {
      left: `${left}%`,
      transform:
        edge === "start"
          ? "translateX(0)"
          : edge === "end"
            ? "translateX(-100%)"
            : "translateX(-50%)"
    };
  }

  function formatWaitRemaining(ms: number | null): string {
    if (ms === null) {
      return "";
    }

    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function buildFcTrendLine(
    days: Array<{ startDay: number | null; sunHours: number | null; night: number | null }>,
    selector: "startDay" | "sunHours" | "night"
  ): string {
    const count = days.length;
    if (count === 0) {
      return "";
    }

    const stepX = count === 1 ? 0 : 280 / (count - 1);
    const yFromPpm = (value: number) => 20 + ((10 - Math.min(10, Math.max(0, value))) / 10) * 140;

    return days
      .map((day, index) => {
        const value = day[selector];
        if (value === null) {
          return null;
        }
        const x = 40 + index * stepX;
        const y = yFromPpm(value);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .filter((value): value is string => value !== null)
      .join(" ");
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
        kind: "adjustment",
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
    setDraft(createDefaultDraft());
    setError(null);
    setReminderMessage(null);
    setPostDraft(defaultPostApplicationDraft);
    setScreen("new-height");
    localStorage.removeItem(UI_STATE_KEY);
  }

  function startQuickCheck(): void {
    if (!config) {
      return;
    }

    const fallbackHeight =
      quickCheckDraft.waterHeightCm ??
      draft.waterHeightCm ??
      latest?.waterHeightCm ??
      config.pool.maxHeightCm ??
      null;
    setQuickCheckDraft({
      ...createDefaultQuickCheckDraft(),
      waterHeightCm: fallbackHeight
    });
    setError(null);
    setScreen("quick-check");
  }

  async function saveQuickCheck(): Promise<void> {
    if (!config || saving) {
      return;
    }

    if (
      quickCheckDraft.waterHeightCm === null ||
      !isHeightInRange(quickCheckDraft.waterHeightCm, config.pool.maxHeightCm)
    ) {
      setError("Ingresa una altura valida para la medicion sin ajuste.");
      return;
    }

    if (quickCheckDraft.measuredPh === null || !isPhInRange(quickCheckDraft.measuredPh)) {
      setError("Ingresa un pH valido (6.8 - 8.2).");
      return;
    }

    if (
      quickCheckDraft.measuredChlorinePpm === null ||
      !isChlorineInRange(quickCheckDraft.measuredChlorinePpm)
    ) {
      setError("Ingresa un cloro valido (0 - 10 ppm).");
      return;
    }

    const volumeLiters = calculateVolumeLiters(config.pool.diameterM, quickCheckDraft.waterHeightCm);

    setSaving(true);
    setError(null);
    try {
      const quickSession: Session = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        kind: "check",
        checkMoment: quickCheckDraft.moment,
        waterHeightCm: quickCheckDraft.waterHeightCm,
        measuredPh: quickCheckDraft.measuredPh,
        measuredChlorinePpm: quickCheckDraft.measuredChlorinePpm,
        calculatedVolumeLiters: toFixedNumber(volumeLiters, 0),
        requiredPhCorrection: { totalMl: 0, stage1Ml: 0 },
        requiredChlorineDose: { maintenanceMl: 0, correctiveMl: 0 },
        appliedDoses: {},
        notes: quickCheckDraft.notes.trim() || undefined
      };

      await sessionRepo.save(quickSession);
      const updatedSessions = await sessionRepo.list();
      setSessions(updatedSessions);
      setQuickCheckDraft(createDefaultQuickCheckDraft());
      setScreen("home");
      localStorage.removeItem(UI_STATE_KEY);
    } catch {
      setError("No se pudo guardar la medicion sin ajuste.");
    } finally {
      setSaving(false);
    }
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

  function markStartupCompleted(): void {
    setStartupDraft((prev) => ({
      ...prev,
      completedAtIso: new Date().toISOString()
    }));
    setScreen("home");
  }

  function resetStartup(): void {
    setStartupDraft(createDefaultStartupDraft());
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
          {startupNeedsAttention ? (
            <p className="inline-note startup-note">
              Inicio de temporada pendiente: define una base quimica antes de la rutina diaria.
            </p>
          ) : (
            <p className="inline-note">
              Inicio de temporada completado el{" "}
              {startupDraft.completedAtIso ? new Date(startupDraft.completedAtIso).toLocaleString() : "-"}.
            </p>
          )}
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
              <p className="inline-note">
                Tipo: {latest.kind === "check" ? "Solo medicion" : "Sesion con ajustes"}
              </p>
            </div>
          ) : (
            <p>Sin mediciones registradas.</p>
          )}
          <div className="metrics-grid">
            <article className="metric">
              <p className="metric-label">Perdida nocturna de Cl</p>
              <p className="metric-value">
                {typeof chlorineLossStats.lastOvernight === "number"
                  ? `${toFixedNumber(chlorineLossStats.lastOvernight, 2)} ppm`
                  : "-"}
              </p>
              <p className="inline-note">
                Promedio:{" "}
                {typeof chlorineLossStats.avgOvernight === "number"
                  ? `${toFixedNumber(chlorineLossStats.avgOvernight, 2)} ppm`
                  : "-"}{" "}
                ({chlorineLossStats.overnightCount} pares)
              </p>
            </article>
            <article className="metric">
              <p className="metric-label">Perdida en horas de sol</p>
              <p className="metric-value">
                {typeof chlorineLossStats.lastDaylight === "number"
                  ? `${toFixedNumber(chlorineLossStats.lastDaylight, 2)} ppm`
                  : "-"}
              </p>
              <p className="inline-note">
                Promedio:{" "}
                {typeof chlorineLossStats.avgDaylight === "number"
                  ? `${toFixedNumber(chlorineLossStats.avgDaylight, 2)} ppm`
                  : "-"}{" "}
                ({chlorineLossStats.daylightCount} pares)
              </p>
            </article>
          </div>
          {daylightLossRiskAlert ? (
            <p className="status-pill status-danger">
              Alerta: perdida diurna alta. Probable impacto por CYA bajo y/o uso sin cubierta.
            </p>
          ) : null}
          {fcTrend.hasData ? (
            <div className="ph-chart-wrap" aria-label="Grafico temporal de cloro libre por dia">
              <h3 className="chart-title">Grafico FC por dia (AM / Sol / Noche)</h3>
              <p className="chart-subtitle">
                Eje X: dias recientes. Eje Y: cloro medido (ppm). Cada linea usa mediciones sin
                ajuste.
              </p>
              <svg className="fc-trend-chart" viewBox="0 0 330 210" role="img">
                <title>Tendencia de cloro libre por dia y momento</title>
                <line className="axis-line" x1="40" y1="20" x2="40" y2="160" />
                <line className="axis-line" x1="40" y1="160" x2="320" y2="160" />
                <text className="axis-text" x="10" y="24">
                  10
                </text>
                <text className="axis-text" x="14" y="94">
                  5
                </text>
                <text className="axis-text" x="20" y="164">
                  0
                </text>
                <polyline
                  className="fc-trend-line fc-trend-am"
                  points={buildFcTrendLine(fcTrend.days, "startDay")}
                />
                <polyline
                  className="fc-trend-line fc-trend-sun"
                  points={buildFcTrendLine(fcTrend.days, "sunHours")}
                />
                <polyline
                  className="fc-trend-line fc-trend-night"
                  points={buildFcTrendLine(fcTrend.days, "night")}
                />
                {fcTrend.days.map((day, index) => {
                  const stepX = fcTrend.days.length === 1 ? 0 : 280 / (fcTrend.days.length - 1);
                  const x = 40 + index * stepX;
                  return (
                    <text key={day.label} className="axis-text" x={x} y="176" textAnchor="middle">
                      {day.label}
                    </text>
                  );
                })}
              </svg>
              <div className="chart-legend">
                <span className="legend-item">
                  <span className="legend-swatch fc-swatch-am" />
                  AM
                </span>
                <span className="legend-item">
                  <span className="legend-swatch fc-swatch-sun" />
                  Sol
                </span>
                <span className="legend-item">
                  <span className="legend-swatch fc-swatch-night" />
                  Noche
                </span>
              </div>
            </div>
          ) : null}
          <div className="actions">
            <button className="btn-primary" onClick={startNewSession} type="button">
              Nueva medicion
            </button>
            <button className="btn-secondary" onClick={startQuickCheck} type="button">
              Medicion sin ajuste
            </button>
            <button className="btn-secondary" onClick={() => setScreen("startup")} type="button">
              Inicio de temporada
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

      {screen === "startup" ? (
        <section className="card">
          <h2 className="section-title">Inicio de temporada</h2>
          <p className="inline-note">
            Usa modo basico si solo cuentas con pH + OTO. El modo avanzado agrega TA/CYA/CC si tienes
            esas mediciones.
          </p>
          <label className="field-label">
            Modo
            <select
              className="field-input"
              value={startupDraft.mode}
              onChange={(event) =>
                setStartupDraft((prev) => ({
                  ...prev,
                  mode: event.target.value === "advanced" ? "advanced" : "basic"
                }))
              }
            >
              <option value="basic">Basico (pH + cloro)</option>
              <option value="advanced">Avanzado (TA/CYA/CC)</option>
            </select>
          </label>
          <label className="field-label">
            pH medido
            <input
              className="field-input"
              type="number"
              min={6.8}
              max={8.2}
              step={0.1}
              value={startupDraft.measuredPh ?? ""}
              onChange={(event) =>
                setStartupDraft((prev) => ({
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
              value={startupDraft.measuredChlorinePpm ?? ""}
              onChange={(event) =>
                setStartupDraft((prev) => ({
                  ...prev,
                  measuredChlorinePpm:
                    event.target.value === "" ? null : Number(event.target.value)
                }))
              }
            />
          </label>
          {startupDraft.mode === "advanced" ? (
            <>
              <label className="field-label">
                TA medida (ppm)
                <input
                  className="field-input"
                  type="number"
                  min={0}
                  step={1}
                  value={startupDraft.measuredTaPpm ?? ""}
                  onChange={(event) =>
                    setStartupDraft((prev) => ({
                      ...prev,
                      measuredTaPpm: event.target.value === "" ? null : Number(event.target.value)
                    }))
                  }
                />
              </label>
              <label className="field-label">
                CYA medido (ppm)
                <input
                  className="field-input"
                  type="number"
                  min={0}
                  step={1}
                  value={startupDraft.measuredCyaPpm ?? ""}
                  onChange={(event) =>
                    setStartupDraft((prev) => ({
                      ...prev,
                      measuredCyaPpm: event.target.value === "" ? null : Number(event.target.value)
                    }))
                  }
                />
              </label>
              <label className="field-label">
                Cloro combinado (CC, ppm)
                <input
                  className="field-input"
                  type="number"
                  min={0}
                  step={0.1}
                  value={startupDraft.measuredCombinedChlorinePpm ?? ""}
                  onChange={(event) =>
                    setStartupDraft((prev) => ({
                      ...prev,
                      measuredCombinedChlorinePpm:
                        event.target.value === "" ? null : Number(event.target.value)
                    }))
                  }
                />
              </label>
            </>
          ) : null}
          <label className="check-item">
            <input
              type="checkbox"
              checked={startupDraft.waterLooksCloudy}
              onChange={(event) =>
                setStartupDraft((prev) => ({ ...prev, waterLooksCloudy: event.target.checked }))
              }
            />
            Agua turbia o con indicios de algas
          </label>
          <label className="field-label">
            Notas del arranque
            <textarea
              className="field-input textarea-input"
              value={startupDraft.notes}
              onChange={(event) =>
                setStartupDraft((prev) => ({ ...prev, notes: event.target.value }))
              }
              rows={3}
            />
          </label>
          <p className={startupShockSuggested ? "status-pill status-danger" : "status-pill status-ok"}>
            {startupShockSuggested
              ? "Se sugiere shock inicial o correccion intensiva con re-medicion."
              : "No hay gatillo fuerte de shock inicial con los datos ingresados."}
          </p>
          <div className="actions">
            <button className="btn-primary" onClick={markStartupCompleted} type="button">
              Marcar inicio completado
            </button>
            <button className="btn-secondary" onClick={resetStartup} type="button">
              Reiniciar formulario
            </button>
            <button className="btn-secondary" onClick={() => setScreen("home")} type="button">
              Volver
            </button>
          </div>
        </section>
      ) : null}

      {screen === "quick-check" ? (
        <section className="card">
          <h2 className="section-title">Medicion sin ajustes</h2>
          <p className="inline-note">
            Esta pantalla registra observaciones para comparar perdida de cloro entre noche y horas de
            sol, sin proponer dosis.
          </p>
          <label className="field-label">
            Momento de la medicion
            <select
              className="field-input"
              value={quickCheckDraft.moment}
              onChange={(event) =>
                setQuickCheckDraft((prev) => ({
                  ...prev,
                  moment:
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
              value={quickCheckDraft.waterHeightCm ?? ""}
              onChange={(event) =>
                setQuickCheckDraft((prev) => ({
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
              value={quickCheckDraft.measuredPh ?? ""}
              onChange={(event) =>
                setQuickCheckDraft((prev) => ({
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
              value={quickCheckDraft.measuredChlorinePpm ?? ""}
              onChange={(event) =>
                setQuickCheckDraft((prev) => ({
                  ...prev,
                  measuredChlorinePpm:
                    event.target.value === "" ? null : Number(event.target.value)
                }))
              }
            />
          </label>
          <label className="field-label">
            Notas
            <textarea
              className="field-input textarea-input"
              value={quickCheckDraft.notes}
              onChange={(event) =>
                setQuickCheckDraft((prev) => ({ ...prev, notes: event.target.value }))
              }
              rows={3}
            />
          </label>
          <div className="actions">
            <button className="btn-primary" onClick={() => void saveQuickCheck()} disabled={saving} type="button">
              {saving ? "Guardando..." : "Guardar medicion"}
            </button>
            <button className="btn-secondary" onClick={() => setScreen("home")} type="button">
              Volver
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
                  measuredPhIntermediate: null,
                  stage1AppliedAtIso: null,
                  waitReminderNotified: false
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
                  measuredPhIntermediate: null,
                  stage1AppliedAtIso: null,
                  waitReminderNotified: false
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
                const nowIso = new Date().toISOString();
                setDraft((prev) => ({
                  ...prev,
                  appliedPhStage1Ml: prev.appliedPhStage1Ml ?? computed.stage1PhMl,
                  stage1AppliedAtIso: prev.stage1AppliedAtIso ?? nowIso,
                  waitReminderNotified: false
                }));
                setReminderMessage(null);
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
          <h2 className="section-title">Esperar antes de medir de nuevo</h2>
          <p>Luego repetir medicion de pH antes de la etapa 2.</p>
          <p className="inline-note">
            Referencia: este rango aplica a piscinas de poco volumen (por ejemplo, &lt; 5 m3).
          </p>
          <label className="field-label">
            Recordatorio de espera
            <select
              className="field-input"
              value={draft.waitReminderMinutes}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  waitReminderMinutes: parseReminderMinutes(Number(event.target.value)),
                  waitReminderNotified: false
                }))
              }
            >
              {REMINDER_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} minutos
                </option>
              ))}
            </select>
          </label>
          {waitReminderDueMs !== null ? (
            <p className="inline-note">
              Alarma programada para: {new Date(waitReminderDueMs).toLocaleTimeString()} (
              {formatWaitRemaining(waitReminderRemainingMs)} restantes)
            </p>
          ) : null}
          {"Notification" in window && Notification.permission !== "granted" ? (
            <button
              className="btn-secondary"
              type="button"
              onClick={() => {
                void Notification.requestPermission().then((permission) => {
                  if (permission === "granted") {
                    setReminderMessage("Notificaciones activadas para este navegador.");
                  } else {
                    setReminderMessage(
                      "Notificaciones bloqueadas. Se usara una alerta dentro de la app."
                    );
                  }
                });
              }}
            >
              Activar notificaciones del navegador
            </button>
          ) : null}
          {reminderMessage ? <p className="inline-note">{reminderMessage}</p> : null}
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
              Eje X: pH. Compara pH inicial, pH estimado tras la dosis de etapa 1 y pH intermedio medido.
            </p>
            <div className="ph-chart">
              <div
                className="ph-target-band"
                style={{
                  left: `${((config.targets.phMin - PH_CHART_MIN) / (PH_CHART_MAX - PH_CHART_MIN)) * 100}%`,
                  width: `${((config.targets.phMax - config.targets.phMin) / (PH_CHART_MAX - PH_CHART_MIN)) * 100}%`
                }}
              />
              {waitChartMarkers.map((marker) => (
                <span
                  key={marker.key}
                  className={`ph-marker ${marker.className}`}
                  style={phMarkerStyle(marker.phValue)}
                >
                  <span
                    className="ph-marker-label"
                    style={{ top: `${0.2 + marker.lane * 1.15}rem` }}
                  >
                    {marker.label}
                  </span>
                </span>
              ))}
            </div>
            <div className="ph-chart-scale">
              <span className="ph-scale-tick" style={phScaleTickStyle(PH_CHART_MIN, "start")}>
                {PH_CHART_MIN}
              </span>
              <span className="ph-scale-tick" style={phScaleTickStyle(config.targets.phMin, "middle")}>
                {config.targets.phMin}
              </span>
              <span className="ph-scale-tick" style={phScaleTickStyle(config.targets.phMax, "middle")}>
                {config.targets.phMax}
              </span>
              <span className="ph-scale-tick" style={phScaleTickStyle(PH_CHART_MAX, "end")}>
                {PH_CHART_MAX}
              </span>
            </div>
            <p className="axis-label">Eje X (pH)</p>
          </div>
          {phSensitivity ? (
            <div className="ph-chart-wrap" aria-label="Grafico de sensibilidad de pH por TA">
              <h3 className="chart-title">Grafico 2: Sensibilidad por TA estimada</h3>
              <p className="chart-subtitle">
                Eje X: dosis de HCl (ml) hasta la correccion total calculada. Eje Y: pH resultante
                estimado. La linea vertical marca la dosis aplicada en etapa 1.
              </p>
              <svg className="ta-sensitivity-chart" viewBox="0 0 360 220" role="img">
                <title>Curvas de pH estimado segun dosis de HCl y TA</title>
                <line className="axis-line" x1="44" y1="16" x2="44" y2="186" />
                <line className="axis-line" x1="44" y1="186" x2="344" y2="186" />
                <line
                  className="target-line"
                  x1={44 + (phSensitivity.stage1DoseMl / phSensitivity.maxDoseMl) * 300}
                  y1="16"
                  x2={44 + (phSensitivity.stage1DoseMl / phSensitivity.maxDoseMl) * 300}
                  y2="186"
                />
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
                <text
                  className="axis-text"
                  x={44 + (phSensitivity.stage1DoseMl / phSensitivity.maxDoseMl) * 300}
                  y="205"
                  textAnchor="middle"
                >
                  E1 {toFixedNumber(phSensitivity.stage1DoseMl, 0)} ml
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
              {session.kind === "check" ? (
                <p>
                  Tipo: medicion sin ajuste{" "}
                  {session.checkMoment === "start-day"
                    ? "(inicio del dia)"
                    : session.checkMoment === "sun-hours"
                      ? "(horas de sol)"
                      : session.checkMoment === "night"
                        ? "(noche)"
                        : ""}
                </p>
              ) : (
                <p>Tipo: sesion con ajustes</p>
              )}
              {typeof session.measuredPhIntermediate === "number" ? (
                <p>pH intermedio: {session.measuredPhIntermediate}</p>
              ) : null}
              {session.kind !== "check" ? (
                <p>
                  pH etapa 1: {session.requiredPhCorrection.stage1Ml} ml | Cloro:{" "}
                  {session.requiredChlorineDose.correctiveMl} ml
                </p>
              ) : null}
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
          <label className="check-item">
            <input
              type="checkbox"
              checked={settingsDraft.chemistry.usesCover}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        chemistry: {
                          ...prev.chemistry,
                          usesCover: event.target.checked
                        }
                      }
                    : prev
                )
              }
            />
            Uso cubierta cuando la piscina no esta en uso
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
