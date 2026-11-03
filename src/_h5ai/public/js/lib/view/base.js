const {dom, escapeHtml} = require('../util');
const {versionLabel} = require('../util/version');
const config = require('../config');
const changelog = require('./changelog');

const SEL_ROOT = 'body';
const TPL_MAINROW =
        `<div id="mainrow">
            <div id="content"></div>
        </div>`;

const HOMEPAGE = 'https://github.com/pad92/h5ai/';

// "powered by h5ai" links to the project; the version under it opens the
// changelog. A release reads "v1.6.0", any other build its commit id.
const versionButton = version => {
    if (!version) {
        return '';
    }
    return `<button type="button" id="version" class="l10n_title-changelog" title="Changelog">${escapeHtml(versionLabel(version))}</button>`;
};

const init = () => {
    const version = config.setup && config.setup.VERSION;

    const TPL_TOPBAR =
            `<div id="topbar">
                <div id="toolbar"></div>
                <div id="flowbar"></div>
                <div id="backlink">
                    <a id="backlink-home" href="${HOMEPAGE}" title="${HOMEPAGE}">
                        <div class="l10n-poweredBy">powered by h5ai</div>
                    </a>
                    ${versionButton(version)}
                </div>
            </div>`;

    const $root = dom(SEL_ROOT)
        .attr('id', 'root')
        .clr()
        .app(TPL_TOPBAR)
        .app(TPL_MAINROW);

    $root.find('#version').on('click', () => changelog.open());

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
