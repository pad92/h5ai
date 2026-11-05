const {debounce, parsePattern, dom} = require('../util');
const event = require('../core/event');
const resource = require('../core/resource');
const view = require('./view');


// A toolbar tool that shows, instead of the folder, the items matching the
// pattern typed in its input: the filter and the search. Only one is open at
// a time, since each would replace what the other shows.
const tools = [];

// id: the tool's element id, also its image and l10n key.
// settings: advanced and debounceTime.
// find(pattern): the matching items, or a promise of them; null keeps the
// view as it is (an incomplete pattern), a rejection shows the folder again.
// accepts(pattern): whether an item a refresh adds to the folder matches.
const createPatternTool = ({id, settings, find, accepts}) => {
    const $tool = dom(
        `<div id="${id}" class="tool pattern-tool">
            <img class="l10n_alt-${id}" src="${resource.image(id)}" alt="${id}"/>
            <input class="l10n_ph-${id}" type="text"/>
        </div>`
    ).appTo('#toolbar');
    const $input = $tool.find('input');
    let isOpen = false;
    let shownPattern = '';
    // Counts the patterns asked for: an answer to an older one is dropped.
    let request = 0;

    const show = pattern => {
        if (pattern === shownPattern) {
            return;
        }
        shownPattern = pattern;
        request += 1;
        $tool.rmCls('pending');

        if (!pattern) {
            view.setLocation();
            return;
        }

        const current = request;
        $tool.addCls('pending');
        Promise.resolve().then(() => find(pattern)).then(items => {
            if (current !== request) {
                return;
            }
            $tool.rmCls('pending');
            if (items) {
                view.setMatches(items, item => accepts(pattern, item));
            }
        }, () => {
            if (current !== request) {
                return;
            }
            $tool.rmCls('pending');
            // Typing the same pattern again asks again.
            shownPattern = '';
            view.setLocation();
        });
    };

    const update = () => {
        if (isOpen) {
            $tool.addCls('active');
            $input[0].focus();
            show(parsePattern($input.val(), settings.advanced));
        } else {
            show('');
            $tool.rmCls('active');
        }
    };

    const close = () => {
        isOpen = false;
        $input.val('');
        update();
    };

    const api = {close};
    tools.push(api);

    const toggle = () => {
        isOpen = !isOpen;
        if (isOpen) {
            tools.filter(tool => tool !== api).forEach(tool => tool.close());
        }
        update();
    };

    $tool.find('img').on('click', toggle);
    $input.on('keyup', debounce(update, settings.debounceTime));
    event.sub('location.changed', close);

    return api;
};


module.exports = {createPatternTool};
