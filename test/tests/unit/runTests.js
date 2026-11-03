const {test, assert} = require('scar');
const path = require('path');
const {spawnSync} = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(ROOT, 'scripts', 'run-tests.js');

// Runs the runner on a fixture suite, as CI runs it on the real one.
const run = name => spawnSync(process.execPath, [RUNNER, path.join(ROOT, 'test', 'fixtures', 'run-tests', `${name}.js`)], {
    encoding: 'utf8',
    env: {...process.env, H5AI_TEST_TIMEOUT_MS: '200'},
    timeout: 30000
});

test('test runner: exit 0 only when the whole suite passed', () => {
    assert.equal(run('pass').status, 0);
    assert.equal(run('fail').status, 1, 'a failing test fails the run');

    const hang = run('hang');
    assert.equal(hang.status, 1, 'a test that never settles fails the run');
    assert.ok(hang.stdout.includes('Timeout (200ms)'), 'by timing out');
    assert.ok(hang.stdout.includes('2 passed'), 'and the tests after it still run');

    const stall = run('stall');
    assert.equal(stall.status, 1, 'a run stopping before the end fails');
    assert.ok(stall.stderr.includes('stopped before the end of the suite'));

    const unhandled = run('unhandled');
    assert.equal(unhandled.status, 1, 'an unhandled rejection fails the run');
    assert.ok(unhandled.stderr.includes('nobody waits for this'));
});
