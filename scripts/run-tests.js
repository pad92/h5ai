#!/usr/bin/env node
const path = require('path');

// A test that never settles fails instead of stalling the run: with nothing
// left to wait for, Node would exit 0 with the remaining tests never run.
// H5AI_TEST_TIMEOUT_MS shortens it for the runner's own tests.
const TEST_TIMEOUT_MS = Number(process.env.H5AI_TEST_TIMEOUT_MS) || 20000;
// The suite to run: test/index.js, or a file given as the first argument.
const ENTRY = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'test', 'index.js');

let finished = false;
const unhandled = [];

process.on('unhandledRejection', reason => {
    unhandled.push(reason);
});

// The event loop emptied before the suite ended: a test awaited something
// that never came and left no timer behind.
process.on('exit', code => {
    if (!finished && code === 0) {
        console.error('The test run stopped before the end of the suite.');
        process.exitCode = 1;
    }
});

// Register test environment and tests
require(ENTRY);

// Run scar tests programmatically with the bundled reporter
(async () => {
    const scar = require('scar');
    try {
        const suite = await scar.test.run({
            reporter: require('scar/lib/reporter'),
            sync: true,
            // scar sets no timeout by default; the filter sees every test.
            filter: test => {
                if (test.timeout === null) {
                    test.timeout = TEST_TIMEOUT_MS;
                }
                return true;
            }
        });
        finished = true;
        // Node reports a rejection nobody handled once the microtasks ran
        // out: one more turn so a late one is counted.
        await new Promise(resolve => setImmediate(resolve));
        unhandled.forEach(reason => console.error('Unhandled rejection:', reason));
        // The reporter only prints the failures: without this, a failing
        // suite would still exit 0 and pass the CI jobs.
        process.exit(!suite || suite.failed_count || unhandled.length ? 1 : 0);
    } catch (err) {
        finished = true;
        console.error(err);
        process.exit(2);
    }
})();
