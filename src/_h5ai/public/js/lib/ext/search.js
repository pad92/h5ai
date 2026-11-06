const {filter, map, parsePattern, isActivationKey, dom} = require('../util');
const server = require('../server');
const event = require('../core/event');
const i18n = require('../core/i18n');
const location = require('../core/location');
const resource = require('../core/resource');
const allsettings = require('../core/settings');
const Item = require('../model/item');
const view = require('../view/view');

const win = global.window;


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
            <input class="l10n_ph-search l10n_aria-search" type="text" aria-label="search" aria-invalid="false"/>
            <div class="status" role="status"></div>
        </div>`;
const deeperTpl =
        `<button id="search-deeper" type="button">
            <span class="l10n-searchSubfolders"></span>
            <q class="pattern"></q>
        </button>`;
const cutTpl = '<p id="search-cut" class="l10n-searchCut"></p>';

let $tool;
let $input;
let $status;
let $deeper;
let $cut;
let $items;
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
// Whether the field holds an expression that cannot be read.
let isInvalid = false;
// What to put back once the folder of a history entry shows again (Back,
// Forward, a reload): {text, isDeep}, isDeep when the field showed the
// matches of the subfolders; null if nothing.
let toRestore = null;

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

// The settings of what the field does: filter, search, or both.
const usedSettings = () => [canFilter && filterSettings, canSearch && searchSettings].filter(Boolean);

// Tells screen readers how many matches the view shows, and whether the
// search stopped before it could find them all; '' says nothing.
const announce = (count, isCut = false) => {
    if (count === '') {
        $status.text('');
        return;
    }
    const matches = count ? i18n.t('searchMatches', count) : i18n.t('noMatch');
    $status.text(isCut ? matches + '. ' + i18n.t('searchCut') : matches);
};

const updateDeeper = () => {
    $deeper.find('.pattern').text(text);
    if (isOpen && !isDeep && !isInvalid && text && canFilter && canSearch) {
        $deeper.show();
    } else {
        $deeper.hide();
    }
};

// Marks the field when an expression typed after re: cannot be read. The
// view keeps the matches of the previous text, dimmed, and screen readers
// no longer hear their count: they belong to text the field no longer holds.
const updateValidity = () => {
    isInvalid = !!text && usedSettings().some(settings => !regExpOf(settings));
    $input.attr('aria-invalid', isInvalid ? 'true' : 'false');
    if (isInvalid) {
        $tool.addCls('invalid');
        $items.addCls('search-stale');
        announce('');
    } else {
        $tool.rmCls('invalid');
        $items.rmCls('search-stale');
    }
    updateDeeper();
};

const cancelTimer = () => {
    clearTimeout(timer);
    timer = null;
};

// Drops any running search.
const stopSearch = () => {
    request += 1;
    isDeep = false;
    $tool.rmCls('pending');
    $cut.hide();
};

// Drops any running search and shows the current folder: all of it, or the
// items that match the field. An invalid expression leaves the view as is.
// Returns whether the field filtered the folder down to nothing.
const showFolder = () => {
    stopSearch();
    let isNoMatch = false;
    if (!text || !canFilter) {
        view.setLocation();
        announce('');
    } else {
        const re = regExpOf(filterSettings);
        if (re) {
            const accepts = item => view.isListed(item) && labelMatches(re, item);
            const shown = view.setMatches(filter(location.getItem().content, accepts), accepts);
            isNoMatch = shown.length === 0;
            announce(shown.length);
        }
    }
    updateDeeper();
    return isNoMatch;
};

const searchSubfolders = () => {
    cancelTimer();
    if (!text || !canSearch || !regExpOf(searchSettings)) {
        return;
    }

    request += 1;
    const current = request;
    const asked = text;
    isDeep = true;
    updateDeeper();
    $tool.addCls('pending');
    $cut.hide();

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
            // The results answer the field at the time of the request: a
            // file added to the folder since then waits for the next one.
            const shown = view.setMatches(map(response.search, item => Item.get(item)), () => false, true);
            // A search the server cut short may have missed names, which
            // longer text could find too: the line under the matches says so.
            const isCut = !!response.searchTruncated;
            if (!shown.length && !isCut) {
                foundNothingFor = asked;
            }
            if (isCut) {
                $cut.show();
            }
            announce(shown.length, isCut);
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
    updateValidity();
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

// focus: false when the field reopens by itself, on Back or a reload: the
// focus, and on a phone the keyboard, stay where they were.
const open = (focus = true) => {
    isOpen = true;
    $tool.addCls('active');
    $tool.find('img').attr('aria-expanded', 'true');
    if (focus) {
        $input[0].focus();
    }
};

// render: false when the view lists a new folder anyway.
const close = (render = true) => {
    const showsMatches = render && (text !== '' || isDeep);
    cancelTimer();
    isOpen = false;
    text = '';
    foundNothingFor = null;
    $input.val('');
    updateValidity();
    $tool.rmCls('active');
    $tool.find('img').attr('aria-expanded', 'false');
    if (showsMatches) {
        showFolder();
    } else {
        stopSearch();
        updateDeeper();
        announce('');
    }
};

// The history entry's fields for what the field shows: search, the text,
// and searchDeep when it shows the matches of the subfolders.
const stateOf = restored => restored.isDeep ? {search: restored.text, searchDeep: true} : {search: restored.text};

// Leaving a folder by a link keeps the field's text, and whether it showed
// the matches of the subfolders, in its history entry. Arriving on an entry
// by Back, Forward or a reload, whose folder is not the one listed yet,
// takes what it kept, if anything.
const onBeforeChange = () => {
    const history = win.history;
    const state = history && history.state;
    if (state && state.absHref === location.getAbsHref()) {
        const kept = Object.assign({}, state);
        delete kept.search;
        delete kept.searchDeep;
        if (text) {
            Object.assign(kept, stateOf({text, isDeep}));
        }
        history.replaceState(kept, '');
        toRestore = null;
    } else {
        const hasText = state && typeof state.search === 'string';
        toRestore = hasText ? {text: state.search, isDeep: state.searchDeep === true} : null;
    }
};

const onLocationChanged = () => {
    close(false);
    const restored = toRestore;
    toRestore = null;
    if (restored && restored.text) {
        // location rewrote the entry on the way in, without the text: it is
        // written back for the next Back or Forward.
        const state = win.history.state;
        if (state) {
            win.history.replaceState(Object.assign({}, state, stateOf(restored)), '');
        }
        open(false);
        $input.val(restored.text);
        onInput();
        if (restored.isDeep) {
            searchSubfolders();
        }
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
    $status = $tool.find('.status');
    $deeper = dom(deeperTpl).hide().appTo('#view');
    $cut = dom(cutTpl).hide().appTo('#view');
    $items = dom('#items');

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
    event.sub('location.beforeChange', onBeforeChange);
    event.sub('location.changed', onLocationChanged);
};


init();
