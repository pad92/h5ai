#!/usr/bin/env node
const path = require('path');

// Register test environment and tests
require(path.join(__dirname, '..', 'test', 'index.js'));

// Run scar tests programmatically with the bundled reporter
(async () => {
    const scar = require('scar');
    try {
        const suite = await scar.test.run({reporter: require('scar/lib/reporter'), sync: true});
        // The reporter only prints the failures: without this, a failing
        // suite would still exit 0 and pass the CI jobs.
        if (!suite || suite.failed_count) {
            process.exit(1);
        }
    } catch (err) {
        console.error(err);
        process.exit(2);
    }
})();
