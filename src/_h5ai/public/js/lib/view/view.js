const {each, map, includes, intersection, dom} = require('../util');
const event = require('../core/event');
const format = require('../core/format');
const i18n = require('../core/i18n');
const location = require('../core/location');
const resource = require('../core/resource');
const store = require('../core/store');
const allsettings = require('../core/settings');
const base = require('./base');

const modes = ['details', 'grid', 'icons'];
const sizes = [20, 40, 60, 80, 100, 150, 200, 250, 300, 350, 400];
const settings = Object.assign({
    binaryPrefix: false,
    hideFolders: false,
    hideParentFolder: false,
    maxIconSize: 40,
    modes,
    setParentFolderLabels: false,
    sizes
}, allsettings.view);
const sortedSizes = settings.sizes.sort((a, b) => a - b);
const checkedModes = intersection(settings.modes, modes);
const storekey = 'view';
// While a filter or a search shows its matches, a refresh of the folder must
// not bring back what they left out: it adds only the items this accepts.
// Null while the view lists the folder.
let acceptsAdded = null;
// Whether the items shown come from subfolders: each label then starts with
// its folder, relative to the current one.
let showsFolders = false;
// While matches show: name => the [start, end) ranges of the name's
// characters, in NFC, that the field matched, to mark them. Null otherwise.
let highlight = null;
const viewTpl =
        `<div id="view">
            <ul id="items" class="clearfix">
                <li class="header">
                    <a class="icon"></a>
                    <a class="label" href="#"><span class="l10n-name"/></a>
                    <a class="date" href="#"><span class="l10n-lastModified"/></a>
                    <a class="size" href="#"><span class="l10n-size"/></a>
                </li>
            </ul>
            <div id="view-hint"></div>
        </div>`;
const itemTpl =
        `<li class="item">
            <a>
                <span class="icon square"><img src="${resource.blankImage}" alt=""/></span>
                <span class="icon landscape"><img src="${resource.blankImage}" alt=""/></span>
                <span class="label"></span>
                <span class="date"></span>
                <span class="size"></span>
            </a>
        </li>`;
const $view = dom(viewTpl);
const $items = $view.find('#items');
const $hint = $view.find('#view-hint');


// An expired folder size blinks until the refresh worker replaces it.
const showSize = ($size, item) => {
    $size.attr('data-bytes', item.size).text(format.formatSize(item.size));
    if (item.isSizeStale) {
        $size.addCls('stale');
    } else {
        $size.rmCls('stale');
    }
};

const cropSize = (size, min, max) => Math.min(max, Math.max(min, size));

const createStyles = size => {
    const dsize = cropSize(size, 20, 80);
    const gsize = cropSize(size, 40, 160);
    const isize = cropSize(size, 80, 1000);
    const ilsize = Math.round(isize * 4 / 3);
    const important = '!important;';
    const detailsPrefix = `#view.view-details.view-size-${size}`;
    const gridPrefix = `#view.view-grid.view-size-${size}`;
    const iconsPrefix = `#view.view-icons.view-size-${size}`;
    const rules = [
        `${detailsPrefix} .item .label {line-height: ${dsize + 14}px ${important}}`,
        `${detailsPrefix} .item .date {line-height: ${dsize + 14}px ${important}}`,
        `${detailsPrefix} .item .size {line-height: ${dsize + 14}px ${important}}`,
        `${detailsPrefix} .square {width: ${dsize}px ${important} height: ${dsize}px ${important}}`,
        `${detailsPrefix} .square img {width: ${dsize}px ${important} height: ${dsize}px ${important}}`,
        `${detailsPrefix} .label {margin-left: ${dsize + 32}px ${important}}`,

        `${gridPrefix} .item .label {line-height: ${gsize}px ${important}}`,
        `${gridPrefix} .square {width: ${gsize}px ${important} height: ${gsize}px ${important}}`,
        `${gridPrefix} .square img {width: ${gsize}px ${important} height: ${gsize}px ${important}}`,
        // The name and its folder, on two lines centred on the icon.
        `${gridPrefix} .item .label.with-path {line-height: normal ${important} height: ${gsize}px}`,

        `${iconsPrefix} .item {width: ${ilsize}px ${important}}`,
        `${iconsPrefix} .landscape {width: ${ilsize}px ${important} height: ${isize}px ${important}}`,
        `${iconsPrefix} .landscape img {width: ${isize}px ${important} height: ${isize}px ${important}}`,
        `${iconsPrefix} .landscape .thumb {width: ${ilsize}px ${important}}`
    ];

    return rules.join('\n');
};

const addCssStyles = () => {
    const styles = map(sortedSizes, size => createStyles(size));
    styles.push(`#view .icon img {max-width: ${settings.maxIconSize}px; max-height: ${settings.maxIconSize}px;}`);
    dom('<style></style>').text(styles.join('\n')).appTo('head');
};

const set = (mode, size) => {
    const stored = store.get(storekey);

    mode = mode || stored && stored.mode;
    size = size || stored && stored.size;
    mode = includes(settings.modes, mode) ? mode : settings.modes[0];
    size = includes(settings.sizes, size) ? size : settings.sizes[0];
    store.put(storekey, {mode, size});

    each(checkedModes, m => {
        if (m === mode) {
            $view.addCls('view-' + m);
        } else {
            $view.rmCls('view-' + m);
        }
    });

    each(sortedSizes, s => {
        if (s === size) {
            $view.addCls('view-size-' + s);
        } else {
            $view.rmCls('view-size-' + s);
        }
    });

    event.pub('view.mode.changed', mode, size);
};

const getModes = () => checkedModes;
const getMode = () => store.get(storekey).mode;
const setMode = mode => set(mode, null);

const getSizes = () => sortedSizes;
const getSize = () => store.get(storekey).size;
const setSize = size => set(null, size);

const onMouseenter = ev => {
    const item = ev.target._item;
    event.pub('item.mouseenter', item);
};

const onMouseleave = ev => {
    const item = ev.target._item;
    event.pub('item.mouseleave', item);
};

// The folders between the current one and the item, as 'a/b/', or '' for an
// item of the current folder.
const relativeFolder = item => {
    const crumb = item.parent ? item.parent.getCrumb() : [];
    const index = crumb.indexOf(location.getItem());
    return index < 0 ? '' : crumb.slice(index + 1).map(folder => folder.label + '/').join('');
};

// Writes the name into el, with the characters the field matched in <mark>
// while matches show. A name not stored in NFC, as macOS writes them, is
// written as it is, unmarked: the marks count NFC characters.
const writeName = (el, label) => {
    const name = label.normalize('NFC');
    if (!highlight || name !== label) {
        el.textContent = label;
        return;
    }
    const chars = Array.from(name);
    const doc = el.ownerDocument;
    const write = (start, end, isMatch) => {
        const part = chars.slice(start, end).join('');
        if (!part) {
            return;
        }
        if (isMatch) {
            el.appendChild(doc.createElement('mark')).textContent = part;
        } else {
            el.appendChild(doc.createTextNode(part));
        }
    };
    el.textContent = '';
    let at = 0;
    highlight(name).forEach(([start, end]) => {
        write(at, start, false);
        write(start, end, true);
        at = end;
    });
    write(at, chars.length, false);
};

const createHtml = item => {
    const $html = dom(itemTpl);
    const $a = $html.find('a');
    const $iconImg = $html.find('.icon img');
    const $label = $html.find('.label');
    const $date = $html.find('.date');
    const $size = $html.find('.size');

    $html
        .addCls(item.isFolder() ? 'folder' : 'file')
        .on('mouseenter', onMouseenter)
        .on('mouseleave', onMouseleave);

    location.setLink($a, item);

    $label.text(item.label).attr('title', item.label);
    // The folder and the name in their own spans: the folder gives way
    // first when the label is too narrow, and shows on a line of its own in
    // the grid and icon views.
    const folder = showsFolders ? relativeFolder(item) : '';
    let $name = $label;
    if (folder) {
        $name = dom('<span class="name"></span>');
        $label.attr('title', folder + item.label).addCls('with-path').text('')
            .app(dom('<span class="path"></span>').text(folder))
            .app($name);
    }
    writeName($name[0], item.label);
    $date.attr('data-time', item.time).text(format.formatDate(item.time));
    showSize($size, item);
    item.icon = resource.icon(item.type);

    if (item.isFolder() && !item.isManaged) {
        $html.addCls('page');
        item.icon = resource.icon('folder-page');
    }

    if (item.isCurrentParentFolder()) {
        item.icon = resource.icon('folder-parent');
        if (!settings.setParentFolderLabels) {
            $label.addCls('l10n-parentDirectory');
        }
        $html.addCls('folder-parent');
    }
    $iconImg.attr('src', item.icon).attr('alt', item.type);

    item.$view = $html;
    $html[0]._item = item;

    return $html;
};

const checkHint = () => {
    const hasNoItems = $items.find('.item').length === $items.find('.folder-parent').length;

    if (hasNoItems) {
        $hint.show();
    } else {
        $hint.hide();
    }
};

const showItems = items => {
    const removed = map($items.find('.item'), el => el._item);

    $items.find('.item').rm();

    each(items, item => $items.app(createHtml(item)));

    base.$content[0].scrollLeft = 0;
    base.$content[0].scrollTop = 0;
    checkHint();
    event.pub('view.changed', items, removed);
};

// Shows these items as they are: a later refresh adds every new one.
const setItems = items => {
    acceptsAdded = null;
    showsFolders = false;
    highlight = null;
    $view.rmCls('shows-paths');
    showItems(items);
};

const changeItems = (add, remove) => {
    each(add, item => {
        createHtml(item).hide().appTo($items).show();
    });

    // An item the view never showed (a hidden folder, say) has no $view.
    each(remove, item => {
        if (item.$view) {
            item.$view.hide().rm();
        }
    });

    checkHint();
    event.pub('view.changed', add, remove);
};

// One hint at a time, as i18n writes each l10n- class in turn; checkHint()
// then sets whether it is hidden. Written at once: a hint can change while
// the items stay, with no view.changed for the l10n extension.
const setHint = l10nKey => {
    $hint[0].className = 'l10n-' + l10nKey;
    i18n.apply($hint[0]);
    checkHint();
};

// While matches show, name => the ranges of its characters the field
// matched (see setMatches); null otherwise. The sort extension orders the
// matches by them.
const getMarks = () => highlight;

// The key of the hint, shown or hidden.
const getHint = () => {
    const cls = Array.from($hint[0].classList).find(name => name.startsWith('l10n-'));
    return cls ? cls.slice('l10n-'.length) : '';
};

// Whether the view lists this item: hideFolders leaves out the folders, from
// the folder as from its matches.
const isListed = item => !(item.isFolder() && settings.hideFolders);

// Shows matches instead of the folder, without the items the view does not
// list, and returns those shown. A later refresh adds only the new items
// accepts(item) is true for. fromSubfolders: show each item's folder.
// marks: name => the sorted [start, end) ranges of its characters, in NFC,
// to mark as matched; null marks nothing.
const setMatches = (items, accepts, fromSubfolders = false, marks = null) => {
    // Through the exports, which a test replaces: hideFolders is read once,
    // when the view loads.
    const shown = items.filter(item => module.exports.isListed(item));
    acceptsAdded = accepts;
    showsFolders = fromSubfolders;
    highlight = marks;
    if (fromSubfolders) {
        $view.addCls('shows-paths');
    } else {
        $view.rmCls('shows-paths');
    }
    setHint('noMatch');
    showItems(shown);
    return shown;
};

const onLocationChanged = item => {
    if (!item) {
        item = location.getItem();
    }

    const items = [];

    if (item.parent && !settings.hideParentFolder) {
        items.push(item.parent);
    }

    each(item.content, child => {
        if (isListed(child)) {
            items.push(child);
        }
    });

    setHint('empty');
    setItems(items);
};

const onLocationRefreshed = (item, added, removed, updated) => {
    const add = [];

    const isListing = acceptsAdded === null;

    each(added, child => {
        if (isListed(child) && (isListing || acceptsAdded(child))) {
            add.push(child);
        }
    });

    if (isListing) {
        setHint('empty');
    }
    changeItems(add, removed);

    if (updated) {
        each(updated, child => {
            if (child.$view) {
                showSize(child.$view.find('.size'), child);
                child.$view.find('.date').attr('data-time', child.time).text(format.formatDate(child.time));
            }
        });
    }
};

const onResize = () => {
    const width = $view[0].offsetWidth;

    $view.rmCls('width-0').rmCls('width-1');
    if (width < 320) {
        $view.addCls('width-0');
    } else if (width < 480) {
        $view.addCls('width-1');
    }
};

const init = () => {
    addCssStyles();
    set();

    $view.appTo(base.$content);
    $hint.hide();

    format.setDefaultMetric(settings.binaryPrefix);

    event.sub('location.changed', onLocationChanged);
    event.sub('location.refreshed', onLocationRefreshed);
    event.sub('resize', onResize);
    onResize();
};

init();

module.exports = {
    setItems,
    changeItems,
    setLocation: onLocationChanged,
    setHint,
    getHint,
    getMarks,
    setMatches,
    isListed,
    getModes,
    getMode,
    setMode,
    getSizes,
    getSize,
    setSize
};
