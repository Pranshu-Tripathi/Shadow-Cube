const fs = require('fs');
const path = require('path');

function loadJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback();
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallback();
    }
}

function saveJson(filePath, config) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
}

module.exports = {
    loadJson,
    saveJson,
};
