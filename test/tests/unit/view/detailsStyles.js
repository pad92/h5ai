const fs = require('fs');
const path = require('path');
const less = require('less');
const {test, assert} = require('scar');

const LIB = path.join(__dirname, '../../../../src/_h5ai/public/css/lib');

// view-details.less compiled with what it uses, as styles.less includes it.
const detailsCss = async () => {
    const source = ['colors.less', 'mixins.less', 'view/view-details.less']
        .map(file => fs.readFileSync(path.join(LIB, file), 'utf8'))
        .join('\n');
    return (await less.render(source, {math: 'always'})).css;
};

// The declarations of the first rule whose selector list holds selector.
const declarationsOf = (css, selector) => {
    const rule = css.split('}').find(block => block.split('{')[0].split(',').map(sel => sel.trim()).includes(selector));
    return rule ? rule.split('{')[1] : null;
};

test('details view: the column headers ease only their fade, not their size', async () => {
    const declarations = declarationsOf(await detailsCss(), '#view.view-details .header .label');
    assert.ok(declarations, 'the header label rule exists');
    const transition = (/transition:\s*([^;]+);/).exec(declarations);
    assert.ok(transition, 'the header still fades on hover');
    const properties = transition[1].split(',').map(part => part.trim().split(/\s+/)[0]);
    assert.deepEqual(properties.sort(), ['color', 'opacity'],
        'an eased margin lags behind the rows when the view narrows, down to "N" on a phone');
});
