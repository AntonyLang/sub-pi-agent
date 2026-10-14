export const makeSessionStore = (opts = {}) => {
    const ttlMs = opts.ttlMs ?? (Number(process.env.PI_SESSION_TTL_MS) || 30 * 60 * 1000);
    const cleanupMs = opts.cleanupIntervalMs ?? 5 * 60 * 1000;
    const notify = opts.onChange ?? (() => { });
    const map = new Map();
    const prune = () => {
        const cutoff = Date.now() - ttlMs;
        for (const [id, e] of map) {
            if (e.status !== 'running' && e.createdAt < cutoff)
                map.delete(id);
        }
    };
    const handle = setInterval(prune, cleanupMs);
    return {
        add: (id, entry) => { map.set(id, entry); notify(); },
        get: (id) => map.get(id),
        update: (id, patch) => {
            const e = map.get(id);
            if (e) {
                map.set(id, { ...e, ...patch });
                notify();
            }
        },
        remove: (id) => { map.delete(id); notify(); },
        all: () => map,
        dispose: () => { clearInterval(handle); },
    };
};
