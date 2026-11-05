const {test, assert, insp} = require('scar');
const reqlib = require('../../../util/reqlib');
const {parsePattern} = reqlib('util');

test('util.parsePattern()', () => {
    assert.equal(typeof parsePattern, 'function', 'is function');

    [
        ['', false, ''],
        [' ', false, '\\ '],
        ['a', false, 'a'],
        ['ä', false, 'ä'],
        ['á', false, 'á'],
        ['*', false, '\\*'],
        ['ab', false, 'ab'],
        ['rea', false, 'rea'],
        ['re:', false, 're:'],
        ['re:a', false, 're:a'],
        ['a b', false, 'a\\ b'],
        ['ab c', false, 'ab\\ c'],
        [' a ', false, '\\ a\\ '],

        ['', true, ''],
        [' ', true, ''],
        ['a', true, 'a'],
        ['ä', true, 'ä'],
        ['á', true, 'á'],
        ['*', true, '\\*'],
        ['ab', true, 'a.*?b'],
        ['rea', true, 'r.*?e.*?a'],
        [' re:', true, 'r.*?e.*?:'],
        ['are:', true, 'a.*?r.*?e.*?:'],
        ['re:', true, ''],
        ['re:a', true, 'a'],
        ['a b', true, '^(?=.*?a)(?=.*?b)'],
        ['ab c', true, '^(?=.*?a.*?b)(?=.*?c)'],
        [' a ', true, 'a'],
        ['\u{1F600}x', true, '\u{1F600}.*?x']
    ].forEach(([pattern, advanced, exp], idx) => {
        assert.equal(parsePattern(pattern, advanced), exp, `fix#${idx} - (${insp(pattern)}, ${insp(advanced)}) -> ${insp(exp)}`);
    });
});

test('util.parsePattern(): advanced words must all match, in any order', () => {
    const re = new RegExp(parsePattern('photos 2024', true), 'i');
    assert.equal(re.test('2024-06 Photos.zip'), true);
    assert.equal(re.test('Photos.zip'), false, 'one word missing');
    assert.equal(re.test('2024.txt'), false, 'the other word missing');
});
