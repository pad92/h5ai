const {test, assert} = require('scar');
const {packageFileName} = require('../../../scripts/package-name');

test('release archive names stay flat whatever the version', () => {
    [
        ['1.3.7', 'h5ai-1.3.7.zip'],
        ['1.3.7+012~abc1234', 'h5ai-1.3.7+012~abc1234.zip'],
        ['fix/thumbs-tar-json-warmer', 'h5ai-fix-thumbs-tar-json-warmer.zip'],
        ['feature/a b//c', 'h5ai-feature-a-b-c.zip'],
        ['../escape', 'h5ai-..-escape.zip']
    ].forEach(([version, expected]) => {
        assert.equal(packageFileName('h5ai', version), expected, version);
    });
});
