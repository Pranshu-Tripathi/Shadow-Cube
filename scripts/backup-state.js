const { createStateBackup } = require('../src/db/backup');

try {
    const destination = createStateBackup();
    console.log(`State backup created: ${destination}`);
} catch (error) {
    console.error(`State backup failed: ${error.message}`);
    process.exitCode = 1;
}
