export type SessionLogger = {
    delta: (text: string) => Promise<void>;
    end: (output: string) => Promise<void>;
    error: (message: string, output: string) => Promise<void>;
};
export declare const makeSessionLogger: (opts: {
    sessionsDir?: string;
    sessionId: string;
    task: string;
    model?: string;
}) => SessionLogger;
