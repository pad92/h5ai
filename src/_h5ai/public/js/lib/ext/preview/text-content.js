const lolight = require('lolight');
const rawMarked = require('marked');
const marked = typeof rawMarked === 'function' ? rawMarked : rawMarked.parse;
const {dom, sanitizeHtml} = require('../../util');

// Images a Markdown file links to may fail to load: the Docker image's
// Content-Security-Policy blocks every external host (README badges), and a
// relative path may not exist. A failed image is hidden instead of showing
// the browser's broken-image icon or its alt text.
const hideFailedImages = $content => {
    $content.find('img').on('error', ev => ev.target.classList.add('pv-md-img-failed'));
    return $content;
};

const render = (content, style, win) => {
    if (style === 1) {
        return dom('<pre id="pv-content-txt"></pre>').text(content);
    }
    if (style === 2) {
        return hideFailedImages(dom('<div id="pv-content-txt"></div>').html(sanitizeHtml(marked(content))));
    }
    if (style === 3) {
        const $code = dom('<code></code>').text(content);
        win.setTimeout(() => lolight.el($code[0]), content.length < 20000 ? 0 : 500);
        return dom('<pre id="pv-content-txt"></pre>').app($code);
    }
    return dom('<div id="pv-content-txt"></div>').text(content);
};

module.exports = {render};
