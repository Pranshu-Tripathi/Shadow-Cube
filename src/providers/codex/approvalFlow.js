const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const DECISIONS = {
    accept: { label: 'Approve', style: ButtonStyle.Success },
    acceptForSession: { label: 'Approve (session)', style: ButtonStyle.Primary },
    decline: { label: 'Deny', style: ButtonStyle.Secondary },
    cancel: { label: 'Deny & stop', style: ButtonStyle.Danger },
};

function createApprovalFlow({ state, appServer, formatter }) {
    function approvalRows(token) {
        const buttons = Object.entries(DECISIONS).map(([decision, meta]) =>
            new ButtonBuilder()
                .setCustomId(`cxa:${token}:${decision}`)
                .setLabel(meta.label)
                .setStyle(meta.style)
        );
        return [new ActionRowBuilder().addComponents(buttons)];
    }

    async function postApproval(channel, reqId, body) {
        if (!channel) {
            appServer.respond(reqId, { decision: 'decline' });
            return;
        }
        const token = `${state.approvalCounter++}`;
        if (typeof channel.requestApproval === 'function') {
            const approval = { reqId, message: null, resolved: false, surface: null, resolution: null };
            approval.resolve = (decision, context = {}) => {
                if (approval.resolved || !DECISIONS[decision]) return false;
                approval.resolved = true;
                approval.resolution = { decision, context };
                state.pendingApprovals.delete(token);
                appServer.respond(reqId, { decision });
                if (approval.surface?.resolve) {
                    Promise.resolve(approval.surface.resolve(decision, context)).catch((error) => {
                        console.error('[DEBUG] failed to settle approval surfaces:', error.message);
                    });
                }
                return true;
            };
            state.pendingApprovals.set(token, approval);
            const options = Object.entries(DECISIONS).map(([decision, meta]) => ({
                decision,
                label: meta.label,
                tone: decision === 'accept' || decision === 'acceptForSession' ? 'primary' : decision === 'cancel' ? 'danger' : 'default',
            }));
            try {
                approval.surface = await channel.requestApproval(token, body, options, approval.resolve);
                if (approval.resolved && approval.surface?.resolve) {
                    await approval.surface.resolve(approval.resolution.decision, approval.resolution.context);
                }
            } catch (e) {
                if (!approval.resolved) state.pendingApprovals.delete(token);
                console.error('[DEBUG] failed to post web approval:', e.message);
                if (!approval.resolved) appServer.respond(reqId, { decision: 'decline' });
            }
            return;
        }
        const rows = approvalRows(token);
        try {
            const message = await channel.send({ content: body, components: rows });
            state.pendingApprovals.set(token, { reqId, message, resolved: false });
        } catch (e) {
            console.error('[DEBUG] failed to post codex approval:', e.message);
            appServer.respond(reqId, { decision: 'decline' });
        }
    }

    function handleServerRequest(id, method, params) {
        if (method === 'item/commandExecution/requestApproval') {
            const channel = state.channelByThread.get(params.threadId);
            return postApproval(channel, id, formatter.formatCommandApproval(params));
        }
        if (method === 'item/fileChange/requestApproval') {
            const channel = state.channelByThread.get(params.threadId);
            const changes = state.pendingPatches.get(params.itemId);
            return postApproval(channel, id, formatter.formatFileChangeApproval(params, changes));
        }
        appServer.respondError(id, -32601, `unsupported request: ${method}`);
    }

    async function handleCodexApproval(interaction) {
        const parts = (interaction.customId || '').split(':');
        const token = parts[1];
        const decision = parts[2];
        const approval = state.pendingApprovals.get(token);
        if (!approval || approval.resolved) {
            await interaction.reply({ content: 'This approval is no longer active.', ephemeral: true }).catch(() => {});
            return;
        }
        if (!DECISIONS[decision]) {
            await interaction.reply({ content: 'Invalid decision.', ephemeral: true }).catch(() => {});
            return;
        }
        const accepted = typeof approval.resolve === 'function'
            ? approval.resolve(decision, { skipMessageId: interaction.message?.id })
            : (() => {
                approval.resolved = true;
                state.pendingApprovals.delete(token);
                appServer.respond(approval.reqId, { decision });
                return true;
            })();
        if (!accepted) {
            await interaction.reply({ content: 'This approval is no longer active.', ephemeral: true }).catch(() => {});
            return;
        }
        await interaction.update({
            content: interaction.message.content + `\n\n✅ **${DECISIONS[decision].label}**`,
            components: [],
        }).catch(() => {});
    }

    return {
        handleServerRequest,
        handleCodexApproval,
    };
}

module.exports = {
    createApprovalFlow,
};
