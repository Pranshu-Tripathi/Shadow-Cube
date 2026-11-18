function normalizeQuestions(input) {
    const raw = Array.isArray(input?.questions) ? input.questions : [];
    return raw.map((question) => ({
        question: question.question || '',
        header: question.header || '',
        multiSelect: !!question.multiSelect,
        options: Array.isArray(question.options) ? question.options : [],
    }));
}

function createQuestionCoordinator({ writeStdin }) {
    const records = new Map();
    const aliases = new Map();
    const listeners = new Set();

    function canonicalId(id) {
        return aliases.get(id) || id;
    }

    function get(id) {
        return records.get(canonicalId(id)) || null;
    }

    function notify(event) {
        for (const listener of listeners) {
            try {
                listener(event);
            } catch (error) {
                console.error('[DEBUG] question coordinator listener failed:', error.message);
            }
        }
    }

    function create({ conversationId, child, requestId, toolUseId, input }) {
        const existing = get(conversationId);
        if (existing && existing.status === 'pending') return existing;

        const record = {
            conversationId,
            child,
            requestId,
            toolUseId,
            originalInput: input || {},
            questions: normalizeQuestions(input),
            status: 'pending',
            aliases: new Set([conversationId]),
            createdAt: Date.now(),
        };
        records.set(conversationId, record);
        aliases.set(conversationId, conversationId);
        notify({ type: 'created', record });
        return record;
    }

    function addAlias(conversationId, alias) {
        if (!alias) return;
        const record = get(conversationId);
        if (!record) return;
        aliases.set(alias, record.conversationId);
        record.aliases.add(alias);
    }

    function finish(record, event) {
        notify({ ...event, record });
        records.delete(record.conversationId);
        for (const alias of record.aliases) aliases.delete(alias);
    }

    function resolve(id, answers = {}) {
        const record = get(id);
        if (!record || record.status !== 'pending') return { error: 'no pending question' };

        const ok = writeStdin(record.child, {
            type: 'control_response',
            response: {
                subtype: 'success',
                request_id: record.requestId,
                response: {
                    behavior: 'allow',
                    updatedInput: {
                        questions: record.originalInput.questions || [],
                        answers,
                    },
                },
            },
        });
        if (!ok) return { error: 'agent stdin closed' };

        record.status = 'resolved';
        record.answers = answers;
        finish(record, { type: 'resolved', answers });
        return { ok: true };
    }

    function clear(id, summary = 'Question cleared.') {
        const record = get(id);
        if (!record || record.status !== 'pending') return false;
        record.status = 'cleared';
        finish(record, { type: 'cleared', summary });
        return true;
    }

    function subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    return {
        records,
        create,
        get,
        addAlias,
        resolve,
        clear,
        subscribe,
    };
}

module.exports = {
    createQuestionCoordinator,
    normalizeQuestions,
};
