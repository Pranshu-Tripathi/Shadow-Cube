function createOllamaClient({ host }) {
    async function generate({ model, prompt, timeoutMs, keepAlive, temperature = 0, think = false }) {
        const response = await fetch(`${host}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                prompt,
                stream: false,
                think,
                keep_alive: keepAlive,
                options: { temperature },
            }),
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new Error(`ollama returned HTTP ${response.status}`);
        const body = await response.json();
        return body.response || '';
    }

    return { generate };
}

module.exports = { createOllamaClient };
