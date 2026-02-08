import { db } from "../db";
import type { PoolConfig } from "../../domain/types";

const CONFIG_ID = "default";

export const configRepo = {
  load: async (): Promise<PoolConfig | undefined> => {
    return db.config.get(CONFIG_ID);
  },

  save: async (config: PoolConfig): Promise<void> => {
    await db.config.put({
      ...config,
      id: CONFIG_ID,
      updatedAt: new Date().toISOString()
    });
  }
};
