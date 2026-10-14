export type PiSettings = {
    enabledModels?: string[];
    defaultModel?: string;
    defaultProvider?: string;
    packages?: string[];
};
export declare const SUBAGENTS_PACKAGE = "npm:pi-subagents";
export declare const hasSubagents: (settings: PiSettings) => boolean;
export declare const readPiSettings: (path?: string) => Promise<PiSettings>;
export declare const filterByEnabledModels: <T extends {
    provider: string;
    id: string;
}>(models: readonly T[], settings: PiSettings) => T[];
