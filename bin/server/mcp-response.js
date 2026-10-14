export const makeMcpResponse = (agents, value, isError = false) => {
    const payload = { ...value, ...agents.unreadEvents() };
    return { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload,
        ...(isError ? { isError: true } : {}) };
};
