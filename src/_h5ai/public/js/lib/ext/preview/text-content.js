const lolight = require('lolight');
const rawMarked = require('marked');
const marked = typeof rawMarked === 'function' ? rawMarked : rawMarked.parse;
const {dom, sanitizeHtml} = require('../../util');

const render = (content, style, win) => {
    if (style === 1) {
        return dom('<pre id="pv-content-txt"></pre>').text(content);
    }
    if (style === 2) {
        return dom('<div id="pv-content-txt"></div>').html(sanitizeHtml(marked(content)));
    }
    if (style === 3) {
        const $code = dom('<code></code>').text(content);
        win.setTimeout(() => lolight.el($code[0]), content.length < 20000 ? 0 : 500);
        return dom('<pre id="pv-content-txt"></pre>').app($code);
    }
    return dom('<div id="pv-content-txt"></div>').text(content);
};

module.exports = {render};
