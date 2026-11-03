#!/usr/bin/env node
const path = require('path');

// Register test environment and tests
require(path.join(__dirname, '..', 'test', 'index.js'));
// Node-only tests, kept out of the browser bundle of test/index.js
require(path.join(__dirname, '..', 'test', 'node', 'l10n-files.js'));

// Run scar tests programmatically with the bundled reporter
(async () => {
    const scar = require('scar');
    try {
        await scar.test.run({reporter: require('scar/lib/reporter'), sync: true});
    } catch (err) {
        console.error(err);
        process.exit(2);
    }
})();
