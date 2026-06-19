const {dom} = require('../util');
const config = require('../config');

const SEL_ROOT = 'body';
const TPL_MAINROW =
        `<div id="mainrow">
            <div id="content"></div>
        </div>`;

const init = () => {
    const version = config.setup && config.setup.VERSION;
    const versionText = version ? `v${version}` : 'by h5ai';
    const backlinkTitle = version ? `powered by h5ai v${version} - https://github.com/pad92/h5ai/` : 'powered by h5ai - https://github.com/pad92/h5ai/';

    const TPL_TOPBAR =
            `<div id="topbar">
                <div id="toolbar"></div>
                <div id="flowbar"></div>
                <a id="backlink" href="https://github.com/pad92/h5ai/" title="${backlinkTitle}">
                    <div>powered by h5ai</div>
                    <div>${versionText}</div>
                </a>
            </div>`;

    const $root = dom(SEL_ROOT)
        .attr('id', 'root')
        .clr()
        .app(TPL_TOPBAR)
        .app(TPL_MAINROW);

    return {
        $root,
        $topbar: $root.find('#topbar'),
        $toolbar: $root.find('#toolbar'),
        $flowbar: $root.find('#flowbar'),
        $mainrow: $root.find('#mainrow'),
        $content: $root.find('#content')
    };
};

module.exports = init();
