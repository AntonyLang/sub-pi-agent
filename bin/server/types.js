// Exact overrides for models that don't classify cleanly from their name
const MODEL_TIER_OVERRIDES = {
    'o3': 'frontier',
    'o4': 'frontier',
    'o3-mini': 'balanced',
    'o4-mini': 'balanced',
};
// Keywords matched against the bare model name (provider prefix stripped)
const FAST_PATTERN = /\b(flash|haiku|mini|nano)\b/i;
const FRONTIER_PATTERN = /\b(opus|thinking|pro)\b/i;
export const getTier = (modelId) => {
    if (MODEL_TIER_OVERRIDES[modelId])
        return MODEL_TIER_OVERRIDES[modelId];
    // Strip provider prefix: "google/gemini-2.5-pro" → "gemini-2.5-pro"
    const name = modelId.includes('/') ? modelId.split('/').pop() : modelId;
    if (FAST_PATTERN.test(name))
        return 'fast';
    if (FRONTIER_PATTERN.test(name))
        return 'frontier';
    return 'balanced';
};
