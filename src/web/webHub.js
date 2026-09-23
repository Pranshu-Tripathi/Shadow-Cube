// The webHub is the fan-out point between the agent engine and browser clients.
// WebSinks push frames here; the hub broadcasts them to every connected socket and
// keeps a bounded per-conversation log so a client that connects (or reconnects)
// mid-run can replay what it missed. It also tracks pending AskUserQuestion prompts
// so the REST answer endpoint can resolve them back into the agent's stdin.

const MAX_LOG_PER_CONV = 500;

function createWebHub() {
    const clients = new Set();
    // convId -> array of frames (message.create / message.update / event)
    const logs = new Map();
    // convId -> pending question { child, requestId, toolUseId, questions, answers, currentIndex }
    const pendingQuestions = new Map();

    let msgCounter = 0;
    function nextMsgId() {
        msgCounter = (msgCounter + 1) % 1_000_000_000;
        return `m${Date.now().toString(36)}-${msgCounter}`;
    }

    function logFrame(frame) {
        if (!frame.convId) return;
        let arr = logs.get(frame.convId);
        if (!arr) {
            arr = [];
            logs.set(frame.convId, arr);
        }
        // Updates replace the create/update for the same msgId so replay stays compact.
        if (frame.type === 'message.update') {
            const existing = arr.find((f) => f.msgId === frame.msgId);
            if (existing) {
                existing.content = frame.content;
                return;
            }
        }
        arr.push(frame);
        if (arr.length > MAX_LOG_PER_CONV) arr.splice(0, arr.length - MAX_LOG_PER_CONV);
    }

    function broadcast(frame) {
        logFrame(frame);
        const data = JSON.stringify(frame);
        for (const ws of clients) {
            try {
                ws.send(data);
            } catch {
                // socket may be closing; the close handler will prune it
            }
        }
    }

    function addClient(ws) {
        clients.add(ws);
    }

    function removeClient(ws) {
        clients.delete(ws);
    }

    // Send a client the backlog for a conversation it just subscribed to.
    function replay(ws, convId) {
        const arr = logs.get(convId) || [];
        for (const frame of arr) {
            try {
                ws.send(JSON.stringify(frame));
            } catch {
                break;
            }
        }
    }

    function clearConversation(convId) {
        logs.delete(convId);
        pendingQuestions.delete(convId);
    }

    return {
        clients,
        pendingQuestions,
        nextMsgId,
        broadcast,
        addClient,
        removeClient,
        replay,
        clearConversation,
    };
}

module.exports = {
    createWebHub,
};
