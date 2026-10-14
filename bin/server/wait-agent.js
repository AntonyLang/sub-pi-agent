// Only the MCP process checks state while this tool is pending; no model calls are made.
// Reading through the repository also supports a task owned by another MCP process.
export const waitForAgent = (readStatus, timeoutMs = 180_000, signal) => {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
        throw new Error('invalid_timeout: timeout_ms must be an integer from 1 to 300000');
    }
    signal?.throwIfAborted();
    const result = (status) => ({ status, timed_out: status === 'running',
        next: status === 'running' ? 'pi_wait_agent' : status === 'needs_input' ? 'pi_poll_agent' : 'pi_get_result' });
    const initial = readStatus();
    if (initial !== 'running')
        return Promise.resolve(result(initial));
    return new Promise((resolve, reject) => {
        const cleanup = () => { clearInterval(check); clearTimeout(deadline); signal?.removeEventListener('abort', abort); };
        const abort = () => { cleanup(); reject(signal?.reason ?? new Error('Wait cancelled')); };
        const inspect = (expired = false) => {
            try {
                const status = readStatus();
                if (status !== 'running' || expired) {
                    cleanup();
                    resolve(result(status));
                }
            }
            catch (error) {
                cleanup();
                reject(error);
            }
        };
        const check = setInterval(inspect, 250);
        const deadline = setTimeout(() => inspect(true), timeoutMs);
        signal?.addEventListener('abort', abort, { once: true });
    });
};
