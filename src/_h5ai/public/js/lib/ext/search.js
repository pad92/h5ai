const {map} = require('../util');
const server = require('../server');
const location = require('../core/location');
const allsettings = require('../core/settings');
const Item = require('../model/item');
const {createPatternTool} = require('../view/pattern-tool');


const settings = Object.assign({
    enabled: false,
    advanced: false,
    debounceTime: 300,
    ignorecase: true
}, allsettings.search);

const init = () => {
    if (!settings.enabled) {
        return;
    }

    createPatternTool({
        id: 'search',
        settings,
        find: pattern => server.request({
            action: 'get',
            search: {
                href: location.getAbsHref(),
                pattern,
                ignorecase: settings.ignorecase
            }
        }).then(response => map(response.search, item => Item.get(item))),
        // The results answer the pattern at the time it was sent: a file
        // added to the folder since then waits for the next search.
        accepts: () => false
    });
};


init();
