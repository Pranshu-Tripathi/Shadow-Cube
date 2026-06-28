const MAX_MSG_LEN = 1950;

const stripAnsi = (str) => str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
const stripDiscordTags = (str) => str.replace(/<[^>]+>/g, '').trim();

function prettifyCodeBlocks(text) {
    return text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        if (!lang) lang = detectLanguage(code);
        const cleanCode = code.replace(/\n{3,}/g, '\n\n').trim();
        return `\`\`\`${lang}\n${cleanCode}\n\`\`\``;
    });
}

function detectLanguage(code) {
    const trimmed = code.trim();
    if (/^(import|from|def |class |if __name__)/.test(trimmed)) return 'python';
    if (/^(const |let |var |function |import |export |=>|async )/.test(trimmed)) return 'javascript';
    if (/^(interface |type |enum |const \w+:\s)/.test(trimmed)) return 'typescript';
    if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(trimmed)) return 'sql';
    if (/^(\$|#!\/)/.test(trimmed) || /\b(echo|cd|mkdir|rm|grep|awk|sed)\b/.test(trimmed)) return 'bash';
    if (/^<[!a-zA-Z]/.test(trimmed)) return 'html';
    if (/^\{[\s\n]*"/.test(trimmed)) return 'json';
    if (/^(package |func |import \()/.test(trimmed)) return 'go';
    if (/^(use |fn |let mut |pub |impl )/.test(trimmed)) return 'rust';
    return '';
}

function splitForDiscord(text) {
    if (text.length <= MAX_MSG_LEN) return [text];

    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= MAX_MSG_LEN) {
            chunks.push(remaining);
            break;
        }

        let cutPoint = MAX_MSG_LEN;
        const lastNewline = remaining.lastIndexOf('\n', cutPoint);
        if (lastNewline > cutPoint * 0.5) cutPoint = lastNewline;

        let chunk = remaining.slice(0, cutPoint);
        remaining = remaining.slice(cutPoint);

        const openTicks = (chunk.match(/```/g) || []).length;
        if (openTicks % 2 !== 0) {
            chunk += '\n```';
            remaining = '```\n' + remaining;
        }

        chunks.push(chunk);
    }

    return chunks;
}

module.exports = {
    MAX_MSG_LEN,
    stripAnsi,
    stripDiscordTags,
    prettifyCodeBlocks,
    detectLanguage,
    splitForDiscord,
};
