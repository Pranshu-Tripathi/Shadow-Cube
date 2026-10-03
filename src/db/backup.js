const fs = require('fs');
const path = require('path');
const { getDatabase } = require('./database');
const config = require('../config');

function timestamp(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, '-');
}

function createStateBackup({ db = getDatabase(), destinationDir = path.join(config.SESSIONS_DIR, 'backups'), date = new Date() } = {}) {
    fs.mkdirSync(destinationDir, { recursive: true });
    const destination = path.join(destinationDir, `shadow-cube-${timestamp(date)}.sqlite`);
    db.query('VACUUM INTO ?').run(destination);
    return destination;
}

module.exports = { createStateBackup, timestamp };
