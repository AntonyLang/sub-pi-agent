import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, realpathSync, lstatSync, unlinkSync, rmdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, dirname } from 'node:path';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWNER_FILE = /^([1-9][0-9]*)-([0-9a-f-]{36})\.json$/i;
export const agentError = (kind, message) => new Error(`${kind}: ${message}`);
const alive = (pid) => {
    if (!Number.isSafeInteger(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (e) {
        return e.code !== 'ESRCH';
    }
};
const inside = (root, path) => {
    const rel = relative(root, path);
    return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..\\`) && !rel.startsWith('../'));
};
/** Only this private registry is discoverable. No Pi CLI session discovery or arbitrary paths. */
export class AgentRepository {
    root;
    constructor(root) {
        mkdirSync(root, { recursive: true });
        this.root = realpathSync(root);
    }
    directory(id, create = false) {
        if (!UUID.test(id))
            throw agentError('agent_not_found', 'Unknown registered agent ID');
        const dir = join(this.root, id);
        if (create)
            mkdirSync(dir, { recursive: true });
        if (!existsSync(dir))
            throw agentError('agent_not_found', id);
        if (lstatSync(dir).isSymbolicLink() || !inside(this.root, realpathSync(dir))) {
            throw agentError('invalid_agent_path', 'Agent directory escapes the private registry');
        }
        return dir;
    }
    create(record) {
        this.directory(record.session_id, true);
        this.save(record);
    }
    read(id) {
        const file = join(this.directory(id), 'agent.json');
        if (!existsSync(file))
            throw agentError('agent_not_found', id);
        if (lstatSync(file).isSymbolicLink())
            throw agentError('invalid_agent_path', 'Linked metadata is not allowed');
        const r = JSON.parse(readFileSync(file, 'utf8'));
        if (r.owner !== 'agent-pi' || r.version !== 1 || r.session_id !== id ||
            typeof r.cwd !== 'string' || typeof r.name !== 'string' || typeof r.description !== 'string' ||
            !['active', 'needs_input', 'done', 'error', 'interrupted'].includes(r.status) ||
            typeof r.output !== 'string' || !Number.isSafeInteger(r.generation) ||
            !Number.isFinite(r.createdAt) || !Number.isFinite(r.lastActivityAt)) {
            throw agentError('invalid_agent_registration', id);
        }
        return r;
    }
    list() {
        const records = [];
        for (const id of readdirSync(this.root)) {
            if (!UUID.test(id))
                continue;
            try {
                records.push(this.read(id));
            }
            catch { /* unregistered or invalid entries are not agents */ }
        }
        return records;
    }
    save(record) {
        const dir = this.directory(record.session_id);
        const tmp = join(dir, `.agent-${randomUUID()}.tmp`);
        writeFileSync(tmp, JSON.stringify(record), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        renameSync(tmp, join(dir, 'agent.json'));
    }
    eventRead(record, status) {
        return existsSync(join(this.directory(record.session_id), `read-event-${record.generation}-${status}`));
    }
    markEventRead(record, status) {
        // Readers may acknowledge an event while another MCP owns the agent's write lease.
        // Keep this receipt separate so it cannot overwrite the owner's live metadata.
        const dir = this.directory(record.session_id);
        const tmp = join(dir, `.read-event-${randomUUID()}.tmp`);
        writeFileSync(tmp, '', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        renameSync(tmp, join(dir, `read-event-${record.generation}-${status}`));
    }
    leaseFile(id) { return join(this.directory(id), 'runtime.lock'); }
    readLease(id) {
        const dir = this.leaseFile(id);
        try {
            const stat = lstatSync(dir);
            if (stat.isSymbolicLink() || !stat.isDirectory())
                throw agentError('invalid_agent_path', 'Invalid lease directory');
            const files = readdirSync(dir);
            if (files.length !== 1)
                return undefined;
            const match = OWNER_FILE.exec(files[0]);
            if (!match || !UUID.test(match[2]))
                return undefined;
            const file = join(dir, files[0]);
            if (lstatSync(file).isSymbolicLink())
                throw agentError('invalid_agent_path', 'Linked lease owners are not allowed');
            // Ownership is in the filename: a crash in the middle of writing JSON cannot strand it.
            const pid = Number(match[1]);
            return Number.isSafeInteger(pid) ? { pid, token: match[2] } : undefined;
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return undefined;
            throw error;
        }
    }
    isLoaded(id) {
        const lease = this.readLease(id);
        // A just-created lock may not contain its owner yet. Treat it as busy, never steal it.
        if (lease)
            return alive(lease.pid);
        try {
            return Date.now() - lstatSync(this.leaseFile(id)).mtimeMs < 10_000;
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return false;
            throw error;
        }
    }
    acquire(id) {
        const dir = this.leaseFile(id);
        const lease = { pid: process.pid, token: randomUUID() };
        const ownerFile = join(dir, `${lease.pid}-${lease.token}.json`);
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                mkdirSync(dir);
                const inode = lstatSync(dir).ino;
                writeFileSync(ownerFile, JSON.stringify(lease), { flag: 'wx', mode: 0o600 });
                if (lstatSync(dir).ino !== inode || this.readLease(id)?.token !== lease.token) {
                    try {
                        unlinkSync(ownerFile);
                    }
                    catch { /* another claimant already reclaimed this empty lock */ }
                    throw agentError('agent_busy', 'Lease changed while acquiring it');
                }
                return () => {
                    if (this.readLease(id)?.token === lease.token) {
                        unlinkSync(ownerFile);
                        try {
                            rmdirSync(dir);
                        }
                        catch (err) {
                            if (!['ENOENT', 'ENOTEMPTY'].includes(err.code ?? ''))
                                throw err;
                        }
                    }
                };
            }
            catch (e) {
                if (e.code !== 'EEXIST')
                    throw e;
                if (this.isLoaded(id))
                    throw agentError('agent_busy', 'This agent is loaded by another MCP process; release it there first');
                // Remove only the dead owner's uniquely named file. A new owner's file makes rmdir fail,
                // so racing reclaimers cannot unlink a newly acquired lease.
                const dead = this.readLease(id);
                if (dead && alive(dead.pid))
                    throw agentError('agent_busy', 'Another MCP acquired the lease during recovery');
                try {
                    if (dead)
                        unlinkSync(join(dir, `${dead.pid}-${dead.token}.json`));
                    rmdirSync(dir);
                }
                catch (err) {
                    if (!['ENOENT', 'ENOTEMPTY'].includes(err.code ?? ''))
                        throw err;
                }
            }
        }
        throw agentError('agent_busy', id);
    }
    sessionDirectory(id) {
        const dir = join(this.directory(id), 'session');
        if (!existsSync(dir))
            mkdirSync(dir);
        if (lstatSync(dir).isSymbolicLink() || !inside(this.directory(id), realpathSync(dir))) {
            throw agentError('invalid_agent_path', 'Linked session directories are not allowed');
        }
        return dir;
    }
    sessionPath(record) {
        if (!record.sessionFile)
            return undefined;
        if (typeof record.sessionFile !== 'string' || isAbsolute(record.sessionFile) || /(^|[\\/])\.\.([\\/]|$)/.test(record.sessionFile)) {
            throw agentError('invalid_agent_path', 'Invalid registered session path');
        }
        const dir = this.sessionDirectory(record.session_id);
        const path = resolve(this.directory(record.session_id), record.sessionFile);
        if (dirname(path) !== dir || !existsSync(path) || lstatSync(path).isSymbolicLink() || !inside(realpathSync(dir), realpathSync(path))) {
            throw agentError('invalid_agent_path', 'Session is missing or outside its registered private directory');
        }
        return path;
    }
    registerSession(record, path) {
        const dir = this.sessionDirectory(record.session_id);
        if (dirname(resolve(path)) !== dir)
            throw agentError('invalid_agent_path', 'Factory returned an external session');
        record.sessionFile = relative(this.directory(record.session_id), path);
    }
}
