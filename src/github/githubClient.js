function normalizeRepoSlug(input) {
    let repo = input.trim();
    const m = repo.match(/github\.com[/:]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i);
    if (m) repo = m[1];
    return /^[^/\s]+\/[^/\s]+$/.test(repo) ? repo : null;
}

function createGithubClient({ token }) {
    function headers(accept) {
        const result = { 'Accept': accept || 'application/vnd.github+json', 'User-Agent': 'shadow-cube-bridge' };
        if (token) result['Authorization'] = `Bearer ${token}`;
        return result;
    }

    async function defaultBranch(repo) {
        const res = await fetch(`https://api.github.com/repos/${repo}`, { headers: headers() });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching repo metadata`);
        return (await res.json()).default_branch;
    }

    async function fetchFile(repo, filePath, ref) {
        const url = `https://api.github.com/repos/${repo}/contents/${encodeURI(filePath)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
        const res = await fetch(url, { headers: headers('application/vnd.github.raw') });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${filePath}`);
        return Buffer.from(await res.arrayBuffer());
    }

    async function listTree(repo, ref) {
        const res = await fetch(`https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=1`, { headers: headers() });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText} listing tree`);
        return (await res.json()).tree || [];
    }

    async function getRefSha(repo, branch) {
        const res = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, { headers: headers() });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText} resolving ${branch}`);
        return (await res.json()).object.sha;
    }

    async function createBranch(repo, newBranch, fromSha) {
        const res = await fetch(`https://api.github.com/repos/${repo}/git/refs`, {
            method: 'POST',
            headers: { ...headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: fromSha }),
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText} creating branch ${newBranch}`);
    }

    async function putFile(repo, filePath, contentBuf, branch, commitMessage) {
        let sha;
        try {
            const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/${encodeURI(filePath)}?ref=${encodeURIComponent(branch)}`, { headers: headers() });
            if (getRes.ok) sha = (await getRes.json()).sha;
        } catch { }
        const res = await fetch(`https://api.github.com/repos/${repo}/contents/${encodeURI(filePath)}`, {
            method: 'PUT',
            headers: { ...headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: commitMessage, content: contentBuf.toString('base64'), branch, ...(sha ? { sha } : {}) }),
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText} writing ${filePath}`);
    }

    async function openPR(repo, head, base, title, body) {
        const res = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
            method: 'POST',
            headers: { ...headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, head, base, body }),
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText} opening PR`);
        return (await res.json()).html_url;
    }

    return {
        defaultBranch,
        fetchFile,
        listTree,
        getRefSha,
        createBranch,
        putFile,
        openPR,
    };
}

module.exports = {
    normalizeRepoSlug,
    createGithubClient,
};
