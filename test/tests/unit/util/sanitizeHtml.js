const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const {sanitizeHtml} = reqlib('util');

// Custom headers/footers and rendered Markdown go through sanitizeHtml()
// before being inserted into the page.
const cases = [
    ['keeps allowed markup', '<p class="x">a <strong>b</strong> <a href="https://e.org/">c</a></p>', '<p class="x">a <strong>b</strong> <a href="https://e.org/">c</a></p>'],
    ['keeps relative, anchor and mail links', '<a href="sub/">s</a><a href="#top">t</a><a href="mailto:a@e.org">m</a>', '<a href="sub/">s</a><a href="#top">t</a><a href="mailto:a@e.org">m</a>'],
    ['drops scripts with their content', '<p>a</p><script>alert(1)</script>', '<p>a</p>'],
    ['drops styles with their content', '<style>body{display:none}</style><p>a</p>', '<p>a</p>'],
    ['drops embedded documents', '<iframe src="https://e.org/"></iframe><object data="x"></object><embed src="x">', ''],
    ['drops svg and its event handlers', '<svg><g onload="alert(1)"></g></svg>ok', 'ok'],
    ['drops forms', '<form action="https://e.org/"><input name="p"></form>ok', 'ok'],
    ['drops event handler attributes', '<img src="a.png" onerror="alert(1)" alt="a">', '<img src="a.png" alt="a">'],
    ['drops style and srcset attributes', '<p style="color:red">a</p><img src="a.png" srcset="javascript:alert(1) 1x">', '<p>a</p><img src="a.png">'],
    ['drops javascript links', '<a href="javascript:alert(1)">x</a>', '<a>x</a>'],
    ['drops javascript links hidden by case, spaces and tabs', '<a href=" JaVa&#9;Script:alert(1)">x</a><a href="java\nscript:alert(1)">y</a>', '<a>x</a><a>y</a>'],
    ['drops vbscript and file links', '<a href="vbscript:x">v</a><a href="file:///etc/passwd">f</a>', '<a>v</a><a>f</a>'],
    ['keeps inline raster images', '<img src="data:image/png;base64,iVBORw0KGgo=">', '<img src="data:image/png;base64,iVBORw0KGgo=">'],
    ['drops inline SVG and HTML documents', '<img src="data:image/svg+xml;base64,PHN2Zz4="><img src="data:text/html,<script>alert(1)</script>">', '<img><img>'],
    ['drops data links', '<a href="data:image/png;base64,iVBORw0KGgo=">x</a>', '<a>x</a>'],
    ['unwraps unknown elements and keeps their content', '<custom-el><b>kept</b></custom-el>', '<b>kept</b>'],
    ['drops forbidden elements nested in unknown ones', '<custom-el><script>alert(1)</script>ok</custom-el>', 'ok'],
    ['keeps text that only looks like markup', '&lt;script&gt;alert(1)&lt;/script&gt;', '&lt;script&gt;alert(1)&lt;/script&gt;']
];

test('util.sanitizeHtml()', () => {
    assert.equal(typeof sanitizeHtml, 'function', 'is function');
    cases.forEach(([name, input, expected]) => {
        assert.equal(sanitizeHtml(input), expected, name);
    });
});
