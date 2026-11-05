const {filter, map, parsePattern, dom} = require('../util');
const server = require('../server');
const event = require('../core/event');
const location = require('../core/location');
const resource = require('../core/resource');
const allsettings = require('../core/settings');
const Item = require('../model/item');
const view = require('../view/view');


// One field for the filter and the search: typing filters the current folder
// at once, without a request, and a line under the listing, or Enter,
// searches its subfolders on the server. With only one of the two enabled,
// the field does that one.
const filterSettings = Object.assign({
    enabled: false,
    advanced: false,
    debounceTime: 100,
    ignorecase: true
}, allsettings.filter);
const searchSettings = Object.assign({
    enabled: false,
    advanced: false,
    debounceTime: 300,
    ignorecase: true
}, allsettings.search);
const canFilter = filterSettings.enabled;
const canSearch = searchSettings.enabled;

const tpl =
        `<div id="search" class="tool">
            <img class="l10n_alt-search" src="${resource.image('search')}" alt="search"/>
            <input class="l10n_ph-search" type="text"/>
        </div>`;
const deeperTpl =
        `<a id="search-deeper" href="#">
            <span class="l10n-searchSubfolders"></span>
            <q class="pattern"></q>
        </a>`;

let $tool;
let $input;
let $deeper;
let isOpen = false;
// What the field holds, '' when it holds only spaces.
let text = '';
// Whether the view shows the matches of the subfolders.
let isDeep = false;
// Counts what was asked for: a search answer to an older request is dropped.
let request = 0;
let timer = null;

// Names are compared in NFC, as typed, whatever the file system stores.
const regExpOf = settings => {
    try {
        return new RegExp(parsePattern(text.normalize('NFC'), settings.advanced), settings.ignorecase ? 'i' : '');
    } catch {
        return null;
    }
};

const labelMatches = (re, item) => re.test(item.label.normalize('NFC'));

const cancelTimer = () => {
    clearTimeout(timer);
    timer = null;
};

const updateDeeper = () => {
    $deeper.find('.pattern').text(text);
    if (isOpen && !isDeep && text && canFilter && canSearch) {
        $deeper.show();
    } else {
        $deeper.hide();
    }
};

// Drops any running search and shows the current folder: all of it, or the
// items that match the field. An invalid expression leaves the view as is.
const showFolder = () => {
    request += 1;
    isDeep = false;
    $tool.rmCls('pending');

    if (!text || !canFilter) {
        view.setLocation();
    } else {
        const re = regExpOf(filterSettings);
        if (re) {
            const accepts = item => labelMatches(re, item);
            view.setMatches(filter(location.getItem().content, accepts), accepts);
        }
    }
    updateDeeper();
};

const searchSubfolders = () => {
    cancelTimer();
    if (!text || !canSearch) {
        return;
    }

    request += 1;
    const current = request;
    isDeep = true;
    updateDeeper();
    $tool.addCls('pending');

    server.request({
        action: 'get',
        search: {
            href: location.getAbsHref(),
            pattern: parsePattern(text.normalize('NFC'), searchSettings.advanced),
            ignorecase: searchSettings.ignorecase
        }
    }).then(response => {
        if (current === request) {
            $tool.rmCls('pending');
            // The results answer the field at the time of the request: a
            // file added to the folder since then waits for the next one.
            view.setMatches(map(response.search, item => Item.get(item)), () => false, true);
        }
    }, () => {
        // Back to the folder; the line under it asks again.
        if (current === request) {
            showFolder();
        }
    });
};

const onInput = () => {
    text = $input.val().trim() ? $input.val() : '';
    cancelTimer();
    if (!text) {
        showFolder();
        return;
    }
    const run = canFilter ? showFolder : searchSubfolders;
    timer = setTimeout(() => {
        timer = null;
        run();
    }, canFilter ? filterSettings.debounceTime : searchSettings.debounceTime);
};

const open = () => {
    isOpen = true;
    $tool.addCls('active');
    $input[0].focus();
};

const close = () => {
    const showsMatches = text !== '' || isDeep;
    cancelTimer();
    isOpen = false;
    text = '';
    $input.val('');
    $tool.rmCls('active');
    if (showsMatches) {
        showFolder();
    } else {
        request += 1;
        $tool.rmCls('pending');
        updateDeeper();
    }
};

const onKeydown = ev => {
    // Enter and Escape pick or drop an input method's candidate first.
    if (ev.isComposing) {
        return;
    }
    if (ev.key === 'Enter' && canSearch) {
        ev.preventDefault();
        searchSubfolders();
    } else if (ev.key === 'Escape') {
        ev.preventDefault();
        close();
    }
};

const init = () => {
    if (!canFilter && !canSearch) {
        return;
    }

    $tool = dom(tpl).appTo('#toolbar');
    $input = $tool.find('input');
    $deeper = dom(deeperTpl).hide().appTo('#view');

    $tool.find('img').on('click', () => {
        if (isOpen) {
            close();
        } else {
            open();
        }
    });
    $input.on('input', onInput).on('keydown', onKeydown);
    $deeper.on('click', ev => {
        ev.preventDefault();
        searchSubfolders();
        $input[0].focus();
    });
    event.sub('location.changed', close);
};


init();
