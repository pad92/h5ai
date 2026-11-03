const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');

const {isRelease, versionLabel} = reqlib('util/version');

test('versionLabel: "v" only before a release number', () => {
    [
        ['1.6.0', 'v1.6.0'],
        ['1.7.0-rc.1', 'v1.7.0-rc.1'],
        ['1.6.0+build.5', 'v1.6.0+build.5'],
        ['1fd0cb1e', '1fd0cb1e'],
        ['12345678', '12345678'],
        ['master', 'master'],
        ['dev', 'dev'],
        ['1.6', '1.6'],
        ['', ''],
        [undefined, '']
    ].forEach(([version, expected]) => {
        assert.equal(versionLabel(version), expected, String(version));
    });
    assert.equal(isRelease('1.6.0'), true);
    assert.equal(isRelease('v1.6.0'), false, 'the script already strips the "v"');
});
