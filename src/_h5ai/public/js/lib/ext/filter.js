const {filter} = require('../util');
const location = require('../core/location');
const allsettings = require('../core/settings');
const {createPatternTool} = require('../view/pattern-tool');


const settings = Object.assign({
    enabled: false,
    advanced: false,
    debounceTime: 100,
    ignorecase: true
}, allsettings.filter);

// The regular expression of a pattern, or null while it is invalid.
const toRegExp = pattern => {
    try {
        return new RegExp(pattern, settings.ignorecase ? 'i' : '');
    } catch {
        return null;
    }
};

const matches = (re, item) => re.test(item.label);

const init = () => {
    if (!settings.enabled) {
        return;
    }

    createPatternTool({
        id: 'filter',
        settings,
        find: pattern => {
            const re = toRegExp(pattern);
            return re && filter(location.getItem().content, item => matches(re, item));
        },
        accepts: (pattern, item) => {
            const re = toRegExp(pattern);
            return Boolean(re) && matches(re, item);
        }
    });
};


init();
