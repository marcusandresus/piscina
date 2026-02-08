import Dexie, { type Table } from "dexie";
import type { PoolConfig, Session } from "../domain/types";

class PiscinaDatabase extends Dexie {
  config!: Table<PoolConfig, string>;
  sessions!: Table<Session, string>;

  constructor() {
    super("piscinaPwaDB");

    this.version(1).stores({
      config: "id, updatedAt",
      sessions: "id, timestamp"
    });
  }
}

export const db = new PiscinaDatabase();
