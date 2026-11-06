const {filter, map, parsePattern, isActivationKey, dom} = require('../util');
const server = require('../server');
const event = require('../core/event');
const location = require('../core/location');
const resource = require('../core/resource');
const allsettings = require('../core/settings');
const Item = require('../model/item');
const view = require('../view/view');


// One field for the filter and the search: typing filters the current folder
// at once, without a request, and a line under the listing, or Enter,
// searches its subfolders on the server. When nothing in the folder matches,
// the subfolders are searched without waiting for either. With only one of
// the two enabled, the field does that one.
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
            <img class="l10n_alt-search" src="${resource.image('search')}" alt="search" role="button" tabindex="0" aria-expanded="false"/>
            <input class="l10n_ph-search l10n_aria-search" type="text" aria-label="search"/>
        </div>`;
const deeperTpl =
        `<button id="search-deeper" type="button">
            <span class="l10n-searchSubfolders"></span>
            <q class="pattern"></q>
        </button>`;

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
// Text whose subfolder search, from this folder, found nothing; null if none.
let foundNothingFor = null;

// Names are compared in NFC, as typed, whatever the file system stores.
const patternOf = settings => parsePattern(text.normalize('NFC'), settings.advanced);

const regExpOf = settings => {
    try {
        return new RegExp(patternOf(settings), settings.ignorecase ? 'i' : '');
    } catch {
        return null;
    }
};

const labelMatches = (re, item) => re.test(item.label.normalize('NFC'));

// Whether a search for the field can only find nothing again: added letters
// or words narrow a literal or advanced pattern, but not an expression
// typed after re:.
const canOnlyFindNothing = () => foundNothingFor !== null &&
    text.startsWith(foundNothingFor) &&
    !(searchSettings.advanced && text.startsWith('re:'));

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

// Drops any running search.
const stopSearch = () => {
    request += 1;
    isDeep = false;
    $tool.rmCls('pending');
};

// Drops any running search and shows the current folder: all of it, or the
// items that match the field. An invalid expression leaves the view as is.
// Returns whether the field filtered the folder down to nothing.
const showFolder = () => {
    stopSearch();
    let isNoMatch = false;
    if (!text || !canFilter) {
        view.setLocation();
    } else {
        const re = regExpOf(filterSettings);
        if (re) {
            const accepts = item => view.isListed(item) && labelMatches(re, item);
            const matches = filter(location.getItem().content, accepts);
            view.setMatches(matches, accepts);
            isNoMatch = matches.length === 0;
        }
    }
    updateDeeper();
    return isNoMatch;
};

const searchSubfolders = () => {
    cancelTimer();
    if (!text || !canSearch) {
        return;
    }

    request += 1;
    const current = request;
    const asked = text;
    isDeep = true;
    updateDeeper();
    $tool.addCls('pending');

    server.request({
        action: 'get',
        search: {
            href: location.getAbsHref(),
            pattern: patternOf(searchSettings),
            ignorecase: searchSettings.ignorecase
        }
    }).then(response => {
        if (current === request) {
            $tool.rmCls('pending');
            const matches = filter(map(response.search, item => Item.get(item)), view.isListed);
            // A search the server cut short may have missed what longer
            // text would find.
            if (!matches.length && !response.searchTruncated) {
                foundNothingFor = asked;
            }
            // The results answer the field at the time of the request: a
            // file added to the folder since then waits for the next one.
            view.setMatches(matches, () => false, true);
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
    // A search answer would now answer older text: it is dropped, and the
    // next pause filters or searches again.
    request += 1;
    $tool.rmCls('pending');
    if (!text) {
        showFolder();
        return;
    }
    // Typing searches by itself only when it may find something; Enter and
    // the line under the listing always search.
    if (!canFilter) {
        if (!canOnlyFindNothing()) {
            timer = setTimeout(searchSubfolders, searchSettings.debounceTime);
        }
        return;
    }
    timer = setTimeout(() => {
        timer = null;
        // Nothing here: look below once the typing pauses, as the search
        // alone does.
        if (showFolder() && canSearch && !canOnlyFindNothing()) {
            timer = setTimeout(searchSubfolders, searchSettings.debounceTime);
        }
    }, filterSettings.debounceTime);
};

const open = () => {
    isOpen = true;
    $tool.addCls('active');
    $tool.find('img').attr('aria-expanded', 'true');
    $input[0].focus();
};

// render: false when the view lists a new folder anyway.
const close = (render = true) => {
    const showsMatches = render && (text !== '' || isDeep);
    cancelTimer();
    isOpen = false;
    text = '';
    foundNothingFor = null;
    $input.val('');
    $tool.rmCls('active');
    $tool.find('img').attr('aria-expanded', 'false');
    if (showsMatches) {
        showFolder();
    } else {
        stopSearch();
        updateDeeper();
    }
};

const onKeydown = ev => {
    // Enter and Escape pick or drop an input method's candidate first;
    // Safari sends the Enter that ends one with keyCode 229 only.
    if (ev.isComposing || ev.keyCode === 229) {
        return;
    }
    if (ev.key === 'Enter' && canSearch) {
        ev.preventDefault();
        searchSubfolders();
    } else if (ev.key === 'Escape') {
        // Meant for the field only, not for the panels that close on it.
        ev.preventDefault();
        ev.stopPropagation();
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

    const toggle = () => {
        if (isOpen) {
            close();
        } else {
            open();
        }
    };
    // The icon is the field's button: a click, Enter or Space opens or
    // closes it.
    $tool.find('img').on('click', toggle).on('keydown', ev => {
        if (isActivationKey(ev)) {
            ev.preventDefault();
            toggle();
        }
    });
    $input.on('input', onInput).on('keydown', onKeydown);
    $deeper.on('click', () => {
        searchSubfolders();
        $input[0].focus();
    });
    event.sub('location.changed', () => close(false));
};


init();
