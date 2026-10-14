import type { PiClient } from './types.js';
import type { ManagedAgents, SpawnAgentInput } from './managed-agents.js';
import type { AgentStatus } from './agent-repository.js';
import type { WaitAgentInput } from './wait-agent.js';
type SpawnParams = SpawnAgentInput;
type SessionIdParam = {
    session_id: string;
};
type SteerParams = SessionIdParam & {
    message: string;
};
type SteerResult = {
    ok: true;
    message: string;
    status: 'queued';
} | {
    ok: false;
    message: string;
    status: 'rejected';
    reason: string;
};
export declare const TOOL_SCHEMAS: readonly [{
    readonly name: "pi_list_models";
    readonly description: "List Pi models available for this session with tier labels (fast/balanced/frontier).";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {};
    };
}, {
    readonly name: "pi_spawn_agent";
    readonly description: "Start a named Pi agent asynchronously. Returns identity/status, not a completed result. Continue independent work; when idle, call pi_wait_agent instead of repeatedly polling. pi_poll_agent reads progress or a needs_input question; answer through pi_continue_agent on the same ID. Read final delivery with pi_get_result once done. Unread events may accompany any tool response; no live notifications. Use pi_list_agents for reuse. Omit model to follow Pi settings.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly task: {
                readonly type: "string";
                readonly description: "Task description for the Pi agent";
            };
            readonly model: {
                readonly type: "string";
                readonly description: "Optional model key in \"provider/model-id\" format (e.g. anthropic/claude-sonnet-4-6, openai/gpt-4o). Omit to use the model resolved from the user's current Pi settings default (read per task, so a settings change applies to the next spawn). Pass an explicit model to override it.";
            };
            readonly cwd: {
                readonly type: "string";
                readonly description: "Absolute task/project working directory. Pass it explicitly when the MCP client starts servers outside the project.";
            };
            readonly name: {
                readonly type: "string";
                readonly description: "Optional human-readable agent name; generated when omitted.";
            };
            readonly description: {
                readonly type: "string";
                readonly description: "Optional short description to help identify and reuse this agent.";
            };
        };
        readonly required: readonly ["task"];
    };
}, {
    readonly name: "pi_steer_agent";
    readonly description: "Queue a steering message for a running Pi agent. Returns the message verbatim plus a delivery status: {ok:true,message,status:\"queued\"} means only that Pi accepted it for delivery after the current assistant turn finishes its tool calls — it does NOT mean the message was delivered or that Pi has responded. {ok:false,message,status:\"rejected\",reason} means nothing was sent (unknown session, session not running, or Pi refused the steer). Use pi_followup_agent to queue a message for after all work is finished.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly session_id: {
                readonly type: "string";
            };
            readonly message: {
                readonly type: "string";
            };
        };
        readonly required: readonly ["session_id", "message"];
    };
}, {
    readonly name: "pi_followup_agent";
    readonly description: "Queue a follow-up message for a spawned Pi agent. Delivered only after the agent finishes all work. Use this when you do not want to interrupt the agent at all.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly session_id: {
                readonly type: "string";
            };
            readonly message: {
                readonly type: "string";
            };
        };
        readonly required: readonly ["session_id", "message"];
    };
}, {
    readonly name: "pi_poll_agent";
    readonly description: "Immediately read latest assistant text, compact activity metadata and any pending question, without reasoning text or raw tool records. output can stay unchanged while Pi thinks or runs tools; activity shows the latest phase/tool and its update time. needs_input returns question {id,text}: answer via pi_continue_agent on the same ID. Reading a question acknowledges its reminder; polling does not acknowledge final delivery. When idle, use pi_wait_agent instead of repeatedly polling.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly session_id: {
                readonly type: "string";
            };
        };
        readonly required: readonly ["session_id"];
    };
}, {
    readonly name: "pi_wait_agent";
    readonly description: "When no independent work remains, wait for this agent to need input, finish, fail or be interrupted. The MCP process waits without calling a model; progress changes alone do not wake it. Already actionable states return immediately. Returns {status,timed_out,next}; no progress, question or delivery body, and no event acknowledgement. On timeout Pi keeps running: wait again or inspect progress. Read questions with pi_poll_agent and final delivery with pi_get_result. Cancelling the wait does not stop Pi.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly session_id: {
                readonly type: "string";
            };
            readonly timeout_ms: {
                readonly type: "integer";
                readonly minimum: 1;
                readonly maximum: 300000;
                readonly default: 180000;
                readonly description: "Maximum wait in milliseconds (default 180000 / 3 minutes, max 300000 / 5 minutes). The MCP client tool timeout must exceed this duration. A timeout does not stop the agent.";
            };
        };
        readonly required: readonly ["session_id"];
    };
}, {
    readonly name: "pi_get_result";
    readonly description: "Read final delivery, without waiting: done returns the last Pi reply, error/interrupted returns the final partial reply and error in the JSON body. Before final delivery exists, returns only {ready:false,reason,next}, never progress or a question body; use pi_poll_agent. Reading final delivery acknowledges its unread event. Results remain readable after release or MCP restart.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly session_id: {
                readonly type: "string";
            };
        };
        readonly required: readonly ["session_id"];
    };
}, {
    readonly name: "pi_list_agents";
    readonly description: "List only this MCP registry, including unloaded recoverable agents. Compact identity/status metadata, no transcript. active means running; needs_input means Pi handed back a question: poll it, then continue the same ID with an answer. Listed agents become eligible for this connection's unread event reminders. Does not refresh idle timers.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly status: {
                readonly type: "string";
                readonly enum: readonly ["active", "needs_input", "done", "error", "interrupted"];
            };
            readonly cwd: {
                readonly type: "string";
                readonly description: "Optional absolute project directory filter.";
            };
        };
    };
}, {
    readonly name: "pi_continue_agent";
    readonly description: "Continue a registered agent by explicit ID, retaining its Pi conversation/tool context. For needs_input, pass the answer as task; otherwise pass the next assignment. Returns identity/status immediately. Do independent work or use pi_wait_agent when idle; pi_poll_agent inspects progress/questions and pi_get_result reads final delivery. Restores released sessions after MCP restart, rejects running agents, never imports arbitrary Pi CLI sessions. Omit model to follow current Pi settings.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly session_id: {
                readonly type: "string";
            };
            readonly task: {
                readonly type: "string";
            };
            readonly model: {
                readonly type: "string";
                readonly description: "Optional explicit override; omitted uses current Pi default.";
            };
        };
        readonly required: readonly ["session_id", "task"];
    };
}, {
    readonly name: "pi_release_agent";
    readonly description: "Unload an idle agent runtime and release its write lease, retaining its name, description, results and native Pi session on disk for later continuation. Rejects busy agents. Does not delete the agent or its context.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly session_id: {
                readonly type: "string";
            };
        };
        readonly required: readonly ["session_id"];
    };
}, {
    readonly name: "pi_terminate_agent";
    readonly description: "Stop the current task, mark it interrupted, and return its partial latest reply. Retains the registered agent and context for explicit continuation; use pi_release_agent to unload an idle runtime.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly session_id: {
                readonly type: "string";
            };
        };
        readonly required: readonly ["session_id"];
    };
}];
export declare const makeTools: (agents: ManagedAgents, client: Pick<PiClient, "listModels">) => {
    schemas: readonly [{
        readonly name: "pi_list_models";
        readonly description: "List Pi models available for this session with tier labels (fast/balanced/frontier).";
        readonly inputSchema: {
            readonly type: "object";
            readonly properties: {};
        };
    }, {
        readonly name: "pi_spawn_agent";
        readonly description: "Start a named Pi agent asynchronously. Returns identity/status, not a completed result. Continue independent work; when idle, call pi_wait_agent instead of repeatedly polling. pi_poll_agent reads progress or a needs_input question; answer through pi_continue_agent on the same ID. Read final delivery with pi_get_result once done. Unread events may accompany any tool response; no live notifications. Use pi_list_agents for reuse. Omit model to follow Pi settings.";
        readonly inputSchema: {
            readonly type: "object";
            readonly properties: {
                readonly task: {
                    readonly type: "string";
                    readonly description: "Task description for the Pi agent";
                };
                readonly model: {
                    readonly type: "string";
                    readonly description: "Optional model key in \"provider/model-id\" format (e.g. anthropic/claude-sonnet-4-6, openai/gpt-4o). Omit to use the model resolved from the user's current Pi settings default (read per task, so a settings change applies to the next spawn). Pass an explicit model to override it.";
                };
                readonly cwd: {
                    readonly type: "string";
                    readonly description: "Absolute task/project working directory. Pass it explicitly when the MCP client starts servers outside the project.";
                };
                readonly name: {
                    readonly type: "string";
                    readonly description: "Optional human-readable agent name; generated when omitted.";
                };
                readonly description: {
                    readonly type: "string";
                    readonly description: "Optional short description to help identify and reuse this agent.";
                };
            };
            readonly required: readonly ["task"];
        };
    }, {
        readonly name: "pi_steer_agent";
        readonly description: "Queue a steering message for a running Pi agent. Returns the message verbatim plus a delivery status: {ok:true,message,status:\"queued\"} means only that Pi accepted it for delivery after the current assistant turn finishes its tool calls — it does NOT mean the message was delivered or that Pi has responded. {ok:false,message,status:\"rejected\",reason} means nothing was sent (unknown session, session not running, or Pi refused the steer). Use pi_followup_agent to queue a message for after all work is finished.";
        readonly inputSchema: {
            readonly type: "object";
            readonly properties: {
                readonly session_id: {
                    readonly type: "string";
                };
                readonly message: {
                    readonly type: "string";
                };
            };
            readonly required: readonly ["session_id", "message"];
        };
    }, {
        readonly name: "pi_followup_agent";
        readonly description: "Queue a follow-up message for a spawned Pi agent. Delivered only after the agent finishes all work. Use this when you do not want to interrupt the agent at all.";
        readonly inputSchema: {
            readonly type: "object";
            readonly properties: {
                readonly session_id: {
                    readonly type: "string";
                };
                readonly message: {
                    readonly type: "string";
                };
            };
            readonly required: readonly ["session_id", "message"];
        };
    }, {
        readonly name: "pi_poll_agent";
        readonly description: "Immediately read latest assistant text, compact activity metadata and any pending question, without reasoning text or raw tool records. output can stay unchanged while Pi thinks or runs tools; activity shows the latest phase/tool and its update time. needs_input returns question {id,text}: answer via pi_continue_agent on the same ID. Reading a question acknowledges its reminder; polling does not acknowledge final delivery. When idle, use pi_wait_agent instead of repeatedly polling.";
        readonly inputSchema: {
            readonly type: "object";
            readonly properties: {
                readonly session_id: {
                    readonly type: "string";
                };
            };
            readonly required: readonly ["session_id"];
        };
    }, {
        readonly name: "pi_wait_agent";
        readonly description: "When no independent work remains, wait for this agent to need input, finish, fail or be interrupted. The MCP process waits without calling a model; progress changes alone do not wake it. Already actionable states return immediately. Returns {status,timed_out,next}; no progress, question or delivery body, and no event acknowledgement. On timeout Pi keeps running: wait again or inspect progress. Read questions with pi_poll_agent and final delivery with pi_get_result. Cancelling the wait does not stop Pi.";
        readonly inputSchema: {
            readonly type: "object";
            readonly properties: {
                readonly session_id: {
                    readonly type: "string";
                };
                readonly timeout_ms: {
                    readonly type: "integer";
                    readonly minimum: 1;
                    readonly maximum: 300000;
                    readonly default: 180000;
                    readonly description: "Maximum wait in milliseconds (default 180000 / 3 minutes, max 300000 / 5 minutes). The MCP client tool timeout must exceed this duration. A timeout does not stop the agent.";
                };
            };
            readonly required: readonly ["session_id"];
        };
    }, {
        readonly name: "pi_get_result";
        readonly description: "Read final delivery, without waiting: done returns the last Pi reply, error/interrupted returns the final partial reply and error in the JSON body. Before final delivery exists, returns only {ready:false,reason,next}, never progress or a question body; use pi_poll_agent. Reading final delivery acknowledges its unread event. Results remain readable after release or MCP restart.";
        readonly inputSchema: {
            readonly type: "object";
            readonly properties: {
                readonly session_id: {
                    readonly type: "string";
                };
            };
            readonly required: readonly ["session_id"];
        };
    }, {
        readonly name: "pi_list_agents";
        readonly description: "List only this MCP registry, including unloaded recoverable agents. Compact identity/status metadata, no transcript. active means running; needs_input means Pi handed back a question: poll it, then continue the same ID with an answer. Listed agents become eligible for this connection's unread event reminders. Does not refresh idle timers.";
        readonly inputSchema: {
            readonly type: "object";
            readonly properties: {
                readonly status: {
                    readonly type: "string";
                    readonly enum: readonly ["active", "needs_input", "done", "error", "interrupted"];
                };
                readonly cwd: {
                    readonly type: "string";
                    readonly description: "Optional absolute project directory filter.";
                };
            };
        };
    }, {
        readonly name: "pi_continue_agent";
        readonly description: "Continue a registered agent by explicit ID, retaining its Pi conversation/tool context. For needs_input, pass the answer as task; otherwise pass the next assignment. Returns identity/status immediately. Do independent work or use pi_wait_agent when idle; pi_poll_agent inspects progress/questions and pi_get_result reads final delivery. Restores released sessions after MCP restart, rejects running agents, never imports arbitrary Pi CLI sessions. Omit model to follow current Pi settings.";
        readonly inputSchema: {
            readonly type: "object";
            readonly properties: {
                readonly session_id: {
                    readonly type: "string";
                };
                readonly task: {
                    readonly type: "string";
                };
                readonly model: {
                    readonly type: "string";
                    readonly description: "Optional explicit override; omitted uses current Pi default.";
                };
            };
            readonly required: readonly ["session_id", "task"];
        };
    }, {
        readonly name: "pi_release_agent";
        readonly description: "Unload an idle agent runtime and release its write lease, retaining its name, description, results and native Pi session on disk for later continuation. Rejects busy agents. Does not delete the agent or its context.";
        readonly inputSchema: {
            readonly type: "object";
            readonly properties: {
                readonly session_id: {
                    readonly type: "string";
                };
            };
            readonly required: readonly ["session_id"];
        };
    }, {
        readonly name: "pi_terminate_agent";
        readonly description: "Stop the current task, mark it interrupted, and return its partial latest reply. Retains the registered agent and context for explicit continuation; use pi_release_agent to unload an idle runtime.";
        readonly inputSchema: {
            readonly type: "object";
            readonly properties: {
                readonly session_id: {
                    readonly type: "string";
                };
            };
            readonly required: readonly ["session_id"];
        };
    }];
    tools: {
        pi_list_models: (_args: Record<string, unknown>) => Promise<{
            models: import("./types.js").ModelInfo[];
        }>;
        pi_spawn_agent: (args: SpawnParams) => Promise<{
            session_id: string;
            name: string;
            description: string;
            status: string;
        }>;
        pi_continue_agent: (args: SessionIdParam & {
            task: string;
            model?: string;
        }) => Promise<{
            session_id: string;
            name: string;
            description: string;
            status: string;
        }>;
        pi_poll_agent: (args: SessionIdParam) => Promise<{
            error?: string | undefined;
            question?: {
                id: string;
                text: string;
            } | undefined;
            next?: string | undefined;
            activity?: import("./types.js").AgentActivity | undefined;
            status: string;
            output: string;
        }>;
        pi_wait_agent: (args: WaitAgentInput, signal?: AbortSignal) => Promise<{
            status: import("./types.js").SessionStatus;
            timed_out: boolean;
            next: string;
        }>;
        pi_get_result: (args: SessionIdParam) => Promise<{
            ready: boolean;
            reason: string;
            next: string;
            status?: undefined;
            output?: undefined;
            error?: undefined;
        } | {
            status: "done";
            output: string;
            ready?: undefined;
            reason?: undefined;
            next?: undefined;
            error?: undefined;
        } | {
            status: "error" | "interrupted";
            output: string;
            error: string;
            ready?: undefined;
            reason?: undefined;
            next?: undefined;
        }>;
        pi_list_agents: (args: {
            status?: AgentStatus;
            cwd?: string;
        }) => Promise<{
            agents: {
                session_id: string;
                name: string;
                description: string;
                status: AgentStatus;
                cwd: string;
                model: string | undefined;
                lastActivityAt: number;
                loaded: boolean;
            }[];
        }>;
        pi_steer_agent: (args: SteerParams) => Promise<SteerResult>;
        pi_followup_agent: (args: SteerParams) => Promise<{
            ok: boolean;
        }>;
        pi_terminate_agent: (args: SessionIdParam) => Promise<{
            output: string;
            status: AgentStatus;
        }>;
        pi_release_agent: (args: SessionIdParam) => Promise<{
            session_id: string;
            released: boolean;
            recoverable: boolean;
        }>;
    };
};
export {};
