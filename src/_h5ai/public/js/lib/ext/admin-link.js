const allsettings = require('../core/settings');
const resource = require('../core/resource');
const {dom} = require('../util');


const settings = Object.assign({
    adminLink: true
}, allsettings.view);
// The info page is the index.php next to the public assets, wherever h5ai
// is installed.
const tpl =
        `<div class="block">
            <a id="admin-link" class="admin-link" href="${allsettings.publicHref}index.php">
                <img src="${resource.image('admin')}" alt=""/>
                <span class="l10n-admin">Administration</span>
            </a>
        </div>`;


const init = () => {
    if (settings.adminLink) {
        dom(tpl).appTo('#sidebar');
    }
};


init();
