import { type PiSettings } from '../server/pi-settings.js';
type ModelLike = {
    provider: string;
    id: string;
};
type RunOpts = {
    getAvailable?: () => readonly ModelLike[] | Promise<readonly ModelLike[]>;
    readSettings?: () => Promise<PiSettings>;
    detectSuperpowers?: () => Promise<boolean>;
    output?: (line: string) => void;
    exit?: (code: number) => void;
};
export declare const run: (opts?: RunOpts) => Promise<void>;
export {};
