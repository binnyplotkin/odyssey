import { SessionRecord, TurnRecord } from "@odyssey/types";
export interface PersistenceStore {
    createSession(session: SessionRecord): Promise<void>;
    getSession(sessionId: string): Promise<SessionRecord | null>;
    updateSession(session: SessionRecord): Promise<void>;
    listSessions(): Promise<SessionRecord[]>;
    appendTurn(turn: TurnRecord): Promise<void>;
    getTurns(sessionId: string): Promise<TurnRecord[]>;
}
export declare function getPersistenceStore(): PersistenceStore;
//# sourceMappingURL=store.d.ts.map