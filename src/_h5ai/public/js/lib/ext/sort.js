const {each, toArray, dom, cmp, naturalCmp} = require('../util');
const event = require('../core/event');
const resource = require('../core/resource');
const allsettings = require('../core/settings');
const store = require('../core/store');
const view = require('../view/view');

const settings = Object.assign({
    enabled: false,
    column: 0,
    reverse: false,
    ignorecase: true,
    natural: false,
    folders: 0
}, allsettings.sort);
const storekey = 'ext/sort';
const tpl = `<img src="${resource.image('sort')}" class="sort l10n_alt-sortOrder" alt="sort order"/>`;

const getTypeOrder = item => item.isFolder() ? settings.folders : 1;
const columnProps = {0: 'label', 1: 'time', 2: 'size'};
const columnClasses = {0: 'label', 1: 'date', 2: 'size'};


const cmpFn = (prop, reverse, ignorecase, natural) => {
    return (el1, el2) => {
        const item1 = el1._item;
        const item2 = el2._item;

        let res = getTypeOrder(item1) - getTypeOrder(item2);
        if (res !== 0) {
            return res;
        }

        let val1 = item1[prop];
        let val2 = item2[prop];

        if (isNaN(val1) || isNaN(val2)) {
            val1 = String(val1);
            val2 = String(val2);

            if (ignorecase) {
                val1 = val1.toLowerCase();
                val2 = val2.toLowerCase();
            }
        }

        res = natural ? naturalCmp(val1, val2) : cmp(val1, val2);
        return reverse ? -res : res;
    };
};

// The marks of the matches the user sorted by a column; while the same
// matches show, a refresh keeps that column.
let marksSortedByColumn = null;

// How well a name matches, smaller first: in fewer pieces, earlier, closer
// together, in a shorter name. A name without marks (not in NFC, or an
// expression that matched nothing visible) comes last.
const relevanceOf = (marks, item) => {
    const name = item.label.normalize('NFC');
    const ranges = name === item.label ? marks(name) : [];
    if (!ranges.length) {
        return [Infinity];
    }
    const first = ranges[0][0];
    const last = ranges[ranges.length - 1][1];
    return [ranges.length, first, last - first, Array.from(name).length];
};

const cmpKeys = (keys1, keys2) => {
    for (let i = 0; i < Math.max(keys1.length, keys2.length); i += 1) {
        const a = i < keys1.length ? keys1[i] : -Infinity;
        const b = i < keys2.length ? keys2[i] : -Infinity;
        if (a !== b) {
            return a < b ? -1 : 1;
        }
    }
    return 0;
};

// Matches show best first, folders before files as in the listing, and the
// names that match as well by name. No column header shows an arrow: a
// click on one sorts by it.
const sortByRelevance = marks => {
    const byName = cmpFn('label', false, settings.ignorecase, settings.natural);
    const els = toArray(dom('#items .item:not(.folder-parent)'));
    const keys = new Map(els.map(el => [el, relevanceOf(marks, el._item)]));
    dom('#items li.header a').rmCls('ascending').rmCls('descending');
    dom(els.sort((el1, el2) => {
        return getTypeOrder(el1._item) - getTypeOrder(el2._item) ||
            cmpKeys(keys.get(el1), keys.get(el2)) ||
            byName(el1, el2);
    })).appTo('#items');
};

const sortItems = (column, reverse) => {
    const $headers = dom('#items li.header a');
    const $header = dom('#items li.header a.' + columnClasses[column]);
    const fn = cmpFn(columnProps[column], reverse, settings.ignorecase, settings.natural);

    store.put(storekey, {column, reverse});

    $headers.rmCls('ascending').rmCls('descending');
    $header.addCls(reverse ? 'descending' : 'ascending');

    dom(toArray(dom('#items .item:not(.folder-parent)')).sort(fn)).appTo('#items');
};

const onContentChanged = () => {
    const marks = view.getMarks();
    if (marks && marks !== marksSortedByColumn) {
        sortByRelevance(marks);
        return;
    }
    const order = store.get(storekey);
    const column = order && order.column || settings.column;
    const reverse = order && order.reverse || settings.reverse;

    sortItems(column, reverse);
};

const addToggles = () => {
    const $header = dom('#items li.header');

    each(columnClasses, (cls, idx) => {
        const pos = idx === '0' ? 'app' : 'pre';
        $header
            .find('a.' + cls)[pos](tpl)
            .on('click', ev => {
                marksSortedByColumn = view.getMarks();
                sortItems(idx, dom(ev.currentTarget).hasCls('ascending'));
                ev.preventDefault();
            });
    });
};

const init = () => {
    if (!settings.enabled) {
        return;
    }

    addToggles();
    event.sub('view.changed', onContentChanged);
};


init();
