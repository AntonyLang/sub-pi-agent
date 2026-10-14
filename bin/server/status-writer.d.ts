import type { SessionStore } from './types.js';
export declare const makeStatusWriter: (opts: {
    statusDir?: string;
    store: SessionStore;
}) => () => Promise<void>;
