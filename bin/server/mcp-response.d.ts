import type { ManagedAgents } from './managed-agents.js';
export declare const makeMcpResponse: (agents: ManagedAgents, value: object, isError?: boolean) => {
    isError?: boolean | undefined;
    content: {
        type: "text";
        text: string;
    }[];
    structuredContent: {};
};
