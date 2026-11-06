const fs = require('fs');
const path = require('path');
const less = require('less');
const {test, assert} = require('scar');

const LIB = path.join(__dirname, '../../../../src/_h5ai/public/css/lib');

test('sidebar: no rule hides the keyboard focus ring', async () => {
    const source = ['colors.less', 'mixins.less', 'view/sidebar.less']
        .map(file => fs.readFileSync(path.join(LIB, file), 'utf8'))
        .join('\n');
    const css = (await less.render(source, {math: 'always'})).css;
    const hiding = css.split('}')
        .map(block => block.split('{'))
        .filter(([, body]) => body && (/outline:\s*(0|none)\b/).test(body))
        .map(([selector]) => selector.trim());
    assert.deepEqual(hiding, [], 'the global :focus-visible ring must reach the sidebar controls');
});
