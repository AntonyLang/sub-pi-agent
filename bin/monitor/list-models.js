import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { getTier } from '../server/types.js';
import { readPiSettings, filterByEnabledModels, hasSubagents } from '../server/pi-settings.js';
const LOG_PREFIX = '[pi-models]';
const REFRESH_TOOL = 'pi_list_models';
const SUPERPOWERS_SKILL = 'claude-pi:superpowers';
const NO_MODELS_MSG = `${LOG_PREFIX} No models available — configure Pi auth with \`pi auth\` or set provider env vars`;
const SUPERPOWERS_HINT = `${LOG_PREFIX} superpowers detected — load ${SUPERPOWERS_SKILL} skill for diverse agentic workflow integration`;
const SUBAGENTS_HINT = `${LOG_PREFIX} pi-subagents detected — delegated agents can fan out further via their own \`subagent\` tool`;
const formatLine = (models, settings) => {
    const parts = models.map(m => `${m.id} (${getTier(m.id)})`).join(', ');
    const defaultKey = settings.defaultProvider && settings.defaultModel
        ? ` — default: ${settings.defaultProvider}/${settings.defaultModel}`
        : '';
    return `${LOG_PREFIX} Available: ${parts}${defaultKey} — use ${REFRESH_TOOL} to refresh`;
};
const defaultGetAvailable = async () => {
    const modelRuntime = await ModelRuntime.create();
    return modelRuntime.getAvailable();
};
const defaultDetectSuperpowers = async () => {
    try {
        const pluginsFile = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
        const raw = await readFile(pluginsFile, 'utf-8');
        const data = JSON.parse(raw);
        const entry = Object.entries(data.plugins ?? {}).find(([k]) => k.toLowerCase().includes('superpowers'));
        if (!entry)
            return false;
        const installPath = entry[1].at(-1)?.installPath;
        if (!installPath)
            return false;
        await readFile(join(installPath, 'skills', 'subagent-driven-development', 'SKILL.md'), 'utf-8');
        return true;
    }
    catch {
        return false;
    }
};
export const run = async (opts = {}) => {
    const { getAvailable = defaultGetAvailable, readSettings = readPiSettings, detectSuperpowers = defaultDetectSuperpowers, output = console.log, exit = process.exit, } = opts;
    try {
        const [rawModels, settings] = await Promise.all([
            Promise.resolve(getAvailable()),
            readSettings().catch(() => ({})),
        ]);
        const models = filterByEnabledModels(rawModels, settings);
        if (models.length === 0) {
            output(NO_MODELS_MSG);
        }
        else {
            output(formatLine(models, settings));
            const hasSuperPowers = await detectSuperpowers().catch(() => false);
            if (hasSuperPowers)
                output(SUPERPOWERS_HINT);
            if (hasSubagents(settings))
                output(SUBAGENTS_HINT);
        }
        exit(0);
    }
    catch (err) {
        console.error(`${LOG_PREFIX} Failed to load models:`, err instanceof Error ? err.message : String(err));
        exit(1);
    }
};
// Only auto-run when this file is the entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    run();
}
