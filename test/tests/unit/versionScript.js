const {test, assert} = require('scar');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'version.sh');

// A stand-in for git on PATH, so the cases do not depend on the clone (or on
// git being installed: the CI test image has none). It logs its arguments and
// answers like git: `describe --exact-match` only when HEAD carries a tag.
const FAKE_GIT = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_GIT_LOG"
case "$1" in
    describe)
        case "$*" in *--exact-match*) ;; *) echo "v0.0.0-3-gdeadbee"; exit 0 ;; esac
        [ -n "$FAKE_TAG" ] || { echo "fatal: no tag exactly matches" >&2; exit 128; }
        echo "$FAKE_TAG" ;;
    rev-parse)
        [ -n "$FAKE_SHA" ] || { echo "fatal: not a git repository" >&2; exit 128; }
        echo "$FAKE_SHA" ;;
    *) exit 1 ;;
esac
`;

const withBin = (withGit, run) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h5ai-version-'));
    const log = path.join(dir, 'git.log');
    fs.writeFileSync(log, '');
    if (withGit) {
        fs.writeFileSync(path.join(dir, 'git'), FAKE_GIT, {mode: 0o755});
    }
    try {
        return run(dir, log);
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
};

// Runs the script with only `env` (no inherited CI or H5AI variables) and
// PATH limited to the fake git, as /bin/sh needs nothing else.
const version = (env, {git = true} = {}) => withBin(git, (dir, log) => {
    const result = spawnSync('/bin/sh', [SCRIPT], {
        encoding: 'utf8',
        env: {PATH: dir, FAKE_GIT_LOG: log, ...env},
        timeout: 10000
    });
    assert.equal(result.status, 0, result.stderr);
    return {out: result.stdout, gitCalls: fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)};
});

test('version.sh: H5AI_VERSION given to the build wins over Git and CI', () => {
    const {out, gitCalls} = version({H5AI_VERSION: '1.6.0', CI_COMMIT_TAG: 'v9.9.9', FAKE_TAG: 'v8.8.8'});
    assert.equal(out, '1.6.0\n');
    assert.deepEqual(gitCalls, []);
});

test('version.sh: a tag pipeline gives its tag without the "v"', () => {
    assert.equal(version({CI_COMMIT_TAG: 'v1.6.0', CI_COMMIT_SHORT_SHA: '1fd0cb1e'}).out, '1.6.0\n');
    assert.equal(version({CI_COMMIT_TAG: 'v1.7.0-rc.1'}).out, '1.7.0-rc.1\n');
});

test('version.sh: a branch pipeline gives its commit, never the branch name', () => {
    const {out, gitCalls} = version({CI_COMMIT_SHORT_SHA: '1fd0cb1e', CI_COMMIT_BRANCH: 'master', FAKE_TAG: 'v1.5.0'});
    assert.equal(out, '1fd0cb1e\n');
    assert.deepEqual(gitCalls, [], 'the CI variables answer, not the clone');
});

test('version.sh: a local clone on a release tag gives the tag', () => {
    const {out, gitCalls} = version({FAKE_TAG: 'v1.6.0', FAKE_SHA: '1fd0cb1e'});
    assert.equal(out, '1.6.0\n');
    assert.equal(gitCalls.length, 1);
    assert.ok(gitCalls[0].includes('--exact-match'), 'a tag further back does not name HEAD');
    assert.ok(gitCalls[0].includes('--match v[0-9]*'), 'only release tags count');
});

test('version.sh: a local commit without a tag gives its short id', () => {
    const {out, gitCalls} = version({FAKE_SHA: '1fd0cb1e'});
    assert.equal(out, '1fd0cb1e\n');
    assert.equal(gitCalls[1], 'rev-parse --short=8 HEAD');
});

test('version.sh: "dev" without Git and outside CI', () => {
    assert.equal(version({}, {git: false}).out, 'dev\n');
    assert.equal(version({H5AI_VERSION: ''}).out, 'dev\n', 'an empty build argument (docker build without it) is unset');
});
