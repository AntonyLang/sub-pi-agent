import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, } from '@modelcontextprotocol/sdk/types.js';
import { getAgentDir, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { makeSessionStore } from './session-store.js';
import { listPiModels } from './pi-client.js';
import { makeTools } from './tools.js';
import { makeStatusWriter } from './status-writer.js';
import { readFileSync } from 'node:fs';
import { resolveRuntimePaths } from './runtime-paths.js';
import { AgentRepository } from './agent-repository.js';
import { ManagedAgents } from './managed-agents.js';
import { makeManagedSessionFactory } from './managed-session.js';
import { makeMcpResponse } from './mcp-response.js';
// ModelRuntime.create() reads Pi's local model store and resolves credentials itself —
// no AuthStorage to thread through. It stays off the network by default (allowModelNetwork
// is false), so this adds ~40ms of local I/O before server.connect(), not a network round trip.
const modelRuntime = await ModelRuntime.create();
const paths = resolveRuntimePaths(getAgentDir());
const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
// writeStatus is assigned after store creation; onChange only fires post-construction
let writeStatus;
const store = makeSessionStore({
    ttlMs: Infinity, // ManagedAgents owns idle unloading; active tasks must never be pruned.
    onChange: () => { writeStatus?.().catch(() => { }); },
});
writeStatus = makeStatusWriter({ store, statusDir: paths.statusDir });
const client = { listModels: () => listPiModels(modelRuntime) };
const agents = new ManagedAgents(new AgentRepository(paths.agentsDir), makeManagedSessionFactory(modelRuntime), store);
const { tools: toolHandlers, schemas } = makeTools(agents, client);
// Each handler has a specific typed params interface (RunTaskParams, SpawnParams, etc.) to keep
// tool implementations type-safe internally. At the MCP dispatch boundary we need a uniform
// index-by-string type; the as unknown as cast is intentional — MCP args arrive untyped and
// each handler validates its own required fields at runtime.
const tools = toolHandlers;
const server = new Server({ name: 'sub-pi-agent', version }, { capabilities: { tools: {} }, instructions: 'Spawn/continue Pi agents asynchronously; retain session_id for reuse. Do independent work, or call pi_wait_agent when idle instead of repeatedly polling. pi_poll_agent reads progress/questions; answer needs_input via pi_continue_agent on the same ID. pi_get_result reads final delivery. Every tool response may carry unread events: reminders, not bodies; follow next_tool. No live notifications.' });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: schemas,
}));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const handler = tools[request.params.name];
    if (!handler) {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }
    try {
        const result = await handler(request.params.arguments ?? {}, extra.signal);
        return makeMcpResponse(agents, result);
    }
    catch (err) {
        // PiError objects are plain discriminated unions — String(obj) produces "[object Object]".
        // JSON.stringify preserves the kind and contextual fields for the MCP caller.
        return makeMcpResponse(agents, { error: err instanceof Error ? err.message : JSON.stringify(err) }, true);
    }
});
const transport = new StdioServerTransport();
await server.connect(transport);
// Write idle status immediately so stale data from a previous process is cleared.
writeStatus().catch(() => { });
let closing = false;
const cleanup = async () => {
    if (closing)
        return;
    closing = true;
    await agents.close();
    await Promise.allSettled([...store.all().values()].map(entry => entry.session.abort()));
    store.dispose();
    process.exit(0);
};
server.onclose = () => { void cleanup(); };
process.on('SIGINT', () => { void cleanup(); });
process.on('SIGTERM', () => { void cleanup(); });
process.stdin.once('end', () => { void cleanup(); });
