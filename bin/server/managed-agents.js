import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { agentError } from './agent-repository.js';
import { waitForAgent } from './wait-agent.js';
export class ManagedAgents {
    repository;
    factory;
    store;
    options;
    live = new Map();
    observed = new Set();
    mutating = new Set();
    timer;
    closed = false;
    constructor(repository, factory, store, options = {}) {
        this.repository = repository;
        this.factory = factory;
        this.store = store;
        this.options = options;
        this.timer = setInterval(() => this.sweep(), options.sweepMs ?? 30_000);
        this.timer.unref();
    }
    now() { return this.options.now?.() ?? Date.now(); }
    view(r) {
        const loaded = this.repository.isLoaded(r.session_id);
        return { session_id: r.session_id, name: r.name, description: r.description,
            status: r.status === 'active' && !loaded ? 'interrupted' : r.status,
            cwd: r.cwd, model: r.model, lastActivityAt: r.lastActivityAt, loaded };
    }
    record(id) {
        const record = this.live.get(id)?.record ?? this.repository.read(id);
        this.observed.add(id);
        return record;
    }
    assertTask(task) {
        if (typeof task !== 'string' || !task.trim())
            throw agentError('invalid_task', 'task must contain text');
        if (this.closed)
            throw agentError('mcp_closed', 'This MCP is closing');
    }
    list({ status, cwd } = {}) {
        if (status && !['active', 'needs_input', 'done', 'error', 'interrupted'].includes(status))
            throw agentError('invalid_status', status);
        const agents = this.repository.list().map(r => this.view(this.live.get(r.session_id)?.record ?? r))
            .filter(r => (!status || r.status === status) && (!cwd || resolve(r.cwd) === resolve(cwd)))
            .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
        for (const agent of agents)
            this.observed.add(agent.session_id);
        return { agents };
    }
    async spawn(input) {
        this.assertTask(input.task);
        for (const key of ['name', 'description', 'cwd', 'model']) {
            if (input[key] !== undefined && typeof input[key] !== 'string')
                throw agentError('invalid_input', `${key} must be a string`);
        }
        if (input.followUp)
            throw agentError('invalid_followup', 'A new agent needs an initial task; use pi_followup_agent on a running agent');
        const id = randomUUID();
        const record = { version: 1, owner: 'agent-pi', session_id: id,
            name: input.name?.trim() || `agent-${id.slice(0, 8)}`,
            description: input.description ?? input.task.split(/\r?\n/)[0].slice(0, 160),
            cwd: resolve(input.cwd ?? process.cwd()), status: 'interrupted', createdAt: this.now(),
            lastActivityAt: this.now(), generation: 0, output: '' };
        this.repository.create(record);
        this.observed.add(id);
        return this.start(record, input.task, input.model);
    }
    async continue({ session_id, task, model }) {
        this.assertTask(task);
        if (model !== undefined && typeof model !== 'string')
            throw agentError('invalid_input', 'model must be a string');
        return this.start(this.record(session_id), task, model);
    }
    async start(record, task, model) {
        const id = record.session_id;
        if (this.mutating.has(id) || this.live.get(id)?.record.status === 'active')
            throw agentError('agent_busy', id);
        this.mutating.add(id);
        let unlock;
        let created;
        try {
            const old = this.live.get(id);
            if (old) {
                this.persist(old);
                old.unsubscribe();
                old.handle.dispose();
                this.live.delete(id);
                unlock = old.unlock;
            }
            else
                unlock = this.repository.acquire(id);
            // Reload only after the write lease is acquired. A different MCP may have continued it.
            record = this.repository.read(id);
            const sessionFile = this.repository.sessionPath(record);
            created = await this.factory({ cwd: record.cwd, sessionDir: this.repository.sessionDirectory(id), sessionFile, model,
                onQuestion: text => {
                    const live = this.live.get(id);
                    if (!live || live.stopping || live.record.status !== 'active')
                        throw agentError('agent_not_running', id);
                    live.record.question = { id: randomUUID(), text };
                    this.persist(live);
                },
            });
            if (this.closed)
                throw agentError('mcp_closed', 'MCP closed before this task started');
            this.repository.registerSession(record, created.sessionFile);
            record = { ...record, model: created.modelKey, generation: record.generation + 1, status: 'active', output: '',
                error: undefined, question: undefined, activity: undefined, lastActivityAt: this.now() };
            this.repository.save(record);
            const live = { handle: created, record, unlock, unsubscribe: () => { }, stopping: false };
            this.live.set(id, live);
            this.store.add(id, { session: created.session, output: '', latestOutput: '', status: 'running', createdAt: record.createdAt, model: record.model });
            live.unsubscribe = created.session.subscribe(delta => { const e = this.store.get(id); if (e)
                this.store.update(id, { output: e.output + delta }); }, () => this.finish(live), error => this.finish(live, error), reply => {
                if (live.stopping)
                    return;
                record.output = reply;
                record.lastActivityAt = this.now();
                this.store.update(id, { latestOutput: reply });
                this.schedulePersist(live);
            }, activity => {
                if (live.stopping || record.status !== 'active')
                    return;
                record.activity = activity;
                record.lastActivityAt = this.now();
                this.schedulePersist(live);
            });
            // Prompt only after registration and subscriptions. Rejections before SDK events must not hang.
            created.start(task).then(() => this.finish(live), error => this.finish(live, error instanceof Error ? error.message : String(error)));
            return { session_id: id, name: record.name, description: record.description,
                status: record.status === 'active' ? 'running' : record.status };
        }
        catch (error) {
            created?.dispose();
            unlock?.();
            this.live.delete(id);
            this.store.remove(id);
            throw error;
        }
        finally {
            this.mutating.delete(id);
        }
    }
    persist(live) {
        if (live.flush) {
            clearTimeout(live.flush);
            live.flush = undefined;
        }
        this.repository.save(live.record);
    }
    schedulePersist(live) {
        if (live.flush)
            return;
        live.flush = setTimeout(() => { live.flush = undefined; this.persist(live); }, 200);
        live.flush.unref();
    }
    finish(live, error) {
        if (live.stopping || live.record.status !== 'active')
            return;
        if (!error && !live.record.output && !live.record.question)
            error = 'Pi completed this task without a text reply';
        live.record.status = error ? 'error' : live.record.question ? 'needs_input' : 'done';
        live.record.error = error;
        live.record.lastActivityAt = this.now();
        this.persist(live);
        this.store.update(live.record.session_id, { status: live.record.status, error });
        live.unsubscribe();
    }
    poll({ session_id }) {
        try {
            const r = this.record(session_id);
            const status = this.view(r).status;
            if (status === 'needs_input')
                this.repository.markEventRead(r, status);
            return { status: status === 'active' ? 'running' : status, output: r.output,
                ...(status === 'active' && r.activity ? { activity: r.activity } : {}),
                ...(status === 'needs_input' ? { question: r.question, next: 'pi_continue_agent' } : {}),
                ...(r.error ? { error: r.error } : {}) };
        }
        catch (error) {
            return { status: 'error', output: '', error: error.message };
        }
    }
    wait({ session_id, timeout_ms }, signal) {
        return waitForAgent(() => {
            const status = this.view(this.record(session_id)).status;
            return status === 'active' ? 'running' : status;
        }, timeout_ms, signal);
    }
    async result({ session_id }) {
        const r = this.record(session_id);
        const status = this.view(r).status;
        if (status === 'active' || status === 'needs_input') {
            return { ready: false, reason: status === 'active' ? 'task_running' : 'needs_input', next: 'pi_poll_agent' };
        }
        this.repository.markEventRead(r, status);
        if (status === 'done')
            return { status, output: r.output };
        return { status, output: r.output, error: r.error ?? 'Task was interrupted; continue it explicitly' };
    }
    unreadEvents() {
        const events = this.repository.list().filter(r => this.observed.has(r.session_id))
            .map(r => this.live.get(r.session_id)?.record ?? r)
            .map(r => ({ record: r, status: this.view(r).status }))
            .filter(({ record, status }) => record.generation > 0 && status !== 'active' && !this.repository.eventRead(record, status))
            .sort((a, b) => a.record.lastActivityAt - b.record.lastActivityAt)
            .map(({ record: r, status }) => ({ event_id: `${r.session_id}:${r.generation}:${status}`,
            session_id: r.session_id, name: r.name, generation: r.generation, type: status,
            next_tool: status === 'needs_input' ? 'pi_poll_agent' : 'pi_get_result' }));
        return events.length ? { events: events.slice(0, 10), ...(events.length > 10 ? { remaining_events: events.length - 10 } : {}) } : {};
    }
    async steer({ session_id, message }) {
        const live = this.live.get(session_id);
        if (!live || live.record.status !== 'active' || live.stopping)
            return { ok: false, message, status: 'rejected', reason: 'Agent is not running in this MCP' };
        try {
            await live.handle.session.steer(message);
            return { ok: true, message, status: 'queued' };
        }
        catch (error) {
            return { ok: false, message, status: 'rejected', reason: error.message ?? String(error) };
        }
    }
    async followup({ session_id, message }) {
        const live = this.live.get(session_id);
        if (!live || live.record.status !== 'active' || live.stopping)
            return { ok: false };
        await live.handle.session.followUp(message);
        return { ok: true };
    }
    release({ session_id }) {
        if (this.mutating.has(session_id))
            throw agentError('agent_busy', session_id);
        const live = this.live.get(session_id);
        if (live) {
            if (live.record.status === 'active')
                throw agentError('agent_busy', 'Stop the current task before releasing its runtime');
            this.persist(live);
            live.unsubscribe();
            live.handle.dispose();
            live.unlock();
            this.live.delete(session_id);
            this.store.remove(session_id);
        }
        else {
            this.repository.read(session_id);
            if (this.repository.isLoaded(session_id))
                throw agentError('agent_busy', 'Agent is loaded by another MCP');
        }
        return { session_id, released: true, recoverable: true };
    }
    sweep() {
        for (const [id, live] of this.live) {
            if (live.record.status !== 'active' && !this.mutating.has(id) && this.now() - live.record.lastActivityAt >= (this.options.idleMs ?? 60 * 60 * 1000)) {
                this.release({ session_id: id });
            }
        }
    }
    async terminate({ session_id }) {
        const live = this.live.get(session_id);
        if (!live) {
            if (this.repository.isLoaded(session_id))
                throw agentError('agent_busy', 'Agent is running in another MCP');
            return { output: this.record(session_id).output, status: this.view(this.record(session_id)).status };
        }
        if (live.record.status === 'active') {
            live.stopping = true;
            await live.handle.session.abort();
            live.record.status = 'interrupted';
            live.record.error = 'Task explicitly terminated';
            live.record.lastActivityAt = this.now();
            this.persist(live);
            this.store.update(session_id, { status: 'interrupted', error: live.record.error });
            live.unsubscribe();
        }
        return { output: live.record.output, status: live.record.status };
    }
    async close() {
        this.closed = true;
        clearInterval(this.timer);
        await Promise.allSettled([...this.live].map(async ([id, live]) => {
            live.stopping = true;
            try {
                if (live.record.status === 'active') {
                    live.record.status = 'interrupted';
                    live.record.error = 'MCP disconnected during this task';
                    live.record.lastActivityAt = this.now();
                    this.persist(live);
                    await live.handle.session.abort();
                }
            }
            finally {
                try {
                    this.persist(live);
                }
                finally {
                    try {
                        live.unsubscribe();
                        live.handle.dispose();
                    }
                    finally {
                        live.unlock();
                        this.store.remove(id);
                    }
                }
            }
        }));
        this.live.clear();
    }
}
