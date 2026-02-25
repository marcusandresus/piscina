import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { defaultPoolConfig } from "../domain/defaults";
import type { PoolConfig, Session } from "../domain/types";

let savedConfig: PoolConfig | undefined;
let savedSessions: Session[] = [];

const repoMocks = vi.hoisted(() => ({
  loadConfigMock: vi.fn(async () => savedConfig),
  saveConfigMock: vi.fn(async (config: PoolConfig) => {
    savedConfig = {
      ...config,
      updatedAt: new Date().toISOString()
    };
  }),
  listSessionsMock: vi.fn(async () =>
    savedSessions.slice().sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
  ),
  saveSessionMock: vi.fn(async (session: Session) => {
    savedSessions.push(session);
  })
}));

vi.mock("../data/repositories/configRepo", () => ({
  configRepo: {
    load: repoMocks.loadConfigMock,
    save: repoMocks.saveConfigMock
  }
}));

vi.mock("../data/repositories/sessionRepo", () => ({
  sessionRepo: {
    list: repoMocks.listSessionsMock,
    save: repoMocks.saveSessionMock
  }
}));

describe("App flows", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    savedConfig = structuredClone(defaultPoolConfig);
    savedSessions = [];
    repoMocks.loadConfigMock.mockClear();
    repoMocks.saveConfigMock.mockClear();
    repoMocks.listSessionsMock.mockClear();
    repoMocks.saveSessionMock.mockClear();
    localStorage.clear();
  });

  it("permite guardar una medicion fuera de ciclo como kind check", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Inicio" });
    await user.click(screen.getByRole("button", { name: "Medicion fuera de ciclo" }));

    await screen.findByRole("heading", { name: "Ingreso de medicion" });
    await user.clear(screen.getByLabelText("pH medido"));
    await user.type(screen.getByLabelText("pH medido"), "7.4");
    await user.clear(screen.getByLabelText("Cloro medido (ppm)"));
    await user.type(screen.getByLabelText("Cloro medido (ppm)"), "1.2");

    await user.click(screen.getByRole("button", { name: "Guardar medicion" }));

    await waitFor(() => expect(repoMocks.saveSessionMock).toHaveBeenCalledTimes(1));
    const saved = repoMocks.saveSessionMock.mock.calls[0][0] as Session;
    expect(saved.kind).toBe("check");
    expect(saved.measuredPh).toBe(7.4);
    expect(saved.measuredChlorinePpm).toBe(1.2);
  });

  it("permite habilitar ciclo intensivo desde configuracion", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Inicio" });
    await user.click(screen.getByRole("button", { name: "Configuracion" }));

    await screen.findByRole("heading", { name: "Configuracion" });
    const toggle = screen.getByRole("checkbox", {
      name: "Habilitar ciclo intensivo (operacion avanzada)"
    });
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "Guardar configuracion" }));

    await screen.findByRole("heading", { name: "Inicio" });
    expect(screen.getByRole("button", { name: "Ciclo intensivo" })).toBeInTheDocument();
    expect(repoMocks.saveConfigMock).toHaveBeenCalled();
  });

  it("guarda mediciones del ciclo intensivo con kind intensive-cycle", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Inicio" });
    await user.click(screen.getByRole("button", { name: "Configuracion" }));
    await screen.findByRole("heading", { name: "Configuracion" });
    await user.click(
      screen.getByRole("checkbox", { name: "Habilitar ciclo intensivo (operacion avanzada)" })
    );
    await user.click(screen.getByRole("button", { name: "Guardar configuracion" }));

    await screen.findByRole("heading", { name: "Inicio" });
    await user.click(screen.getByRole("button", { name: "Ciclo intensivo" }));
    await screen.findByRole("heading", { name: "Ciclo intensivo" });
    await user.click(screen.getByRole("button", { name: "Iniciar ciclo intensivo" }));

    await user.click(screen.getByRole("button", { name: "Registrar medicion del ciclo" }));
    await screen.findByRole("heading", { name: "Ingreso de medicion" });
    await user.selectOptions(
      screen.getByLabelText("Modo"),
      "measure-only"
    );
    await user.selectOptions(screen.getByLabelText("Momento de la medicion"), "night");
    await user.clear(screen.getByLabelText("pH medido"));
    await user.type(screen.getByLabelText("pH medido"), "7.5");
    await user.clear(screen.getByLabelText("Cloro medido (ppm)"));
    await user.type(screen.getByLabelText("Cloro medido (ppm)"), "2.0");
    await user.click(screen.getByRole("button", { name: "Guardar medicion" }));

    await waitFor(() => expect(repoMocks.saveSessionMock).toHaveBeenCalled());
    const lastSaved = repoMocks.saveSessionMock.mock.calls[repoMocks.saveSessionMock.mock.calls.length - 1][0] as Session;
    expect(lastSaved.kind).toBe("intensive-cycle");
    expect(lastSaved.checkMoment).toBe("night");
  });
});
