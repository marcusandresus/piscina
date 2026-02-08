import { useEffect, useState } from "react";
import { configRepo } from "../data/repositories/configRepo";
import { defaultPoolConfig } from "../domain/defaults";
import type { PoolConfig } from "../domain/types";

export function App() {
  const [config, setConfig] = useState<PoolConfig | null>(null);

  useEffect(() => {
    void (async () => {
      const loaded = await configRepo.load();
      if (loaded) {
        setConfig(loaded);
        return;
      }

      await configRepo.save(defaultPoolConfig);
      setConfig(defaultPoolConfig);
    })();
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", margin: "1.25rem" }}>
      <h1>Piscina PWA</h1>
      <p>Bootstrap v1 listo: PWA + dominio + almacenamiento local.</p>
      {config ? (
        <ul>
          <li>Diametro: {config.pool.diameterM} m</li>
          <li>Objetivo pH: {config.targets.phMin} - {config.targets.phMax}</li>
          <li>
            Cloro objetivo: {config.targets.chlorineMinPpm} - {config.targets.chlorineMaxPpm} ppm
          </li>
        </ul>
      ) : (
        <p>Cargando configuracion...</p>
      )}
    </main>
  );
}
