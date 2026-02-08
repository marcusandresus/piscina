import { db } from "../db";
import type { Session } from "../../domain/types";

export const sessionRepo = {
  save: async (session: Session): Promise<void> => {
    await db.sessions.put(session);
  },

  list: async (): Promise<Session[]> => {
    return db.sessions.orderBy("timestamp").reverse().toArray();
  },

  getById: async (id: string): Promise<Session | undefined> => {
    return db.sessions.get(id);
  }
};
