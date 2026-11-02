// The play queue: its entries, the current one, and the shuffled order.
// No DOM and no media here, so the rules can be tested on their own.
//
// Shuffle plays every entry once in a random order, like a deck of cards:
// previous goes back through that order, and the order ends like the queue
// does, unless the queue repeats.

// A random permutation of `list` that starts with `first` when given.
const shuffled = (list, first) => {
    const rest = list.filter(entry => entry !== first);
    for (let i = rest.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return first ? [first, ...rest] : rest;
};

const createQueue = () => {
    let entries = [];
    let current = null;
    // The play order while shuffle is on, else null.
    let order = null;

    const sequence = () => order || entries;

    const setShuffle = isOn => {
        order = isOn ? shuffled(entries, current) : null;
    };

    // The entry `delta` steps away from the current one in the play order.
    // Past either end: null, or around when `wrap`. A new round of shuffle
    // draws a new order, which never starts with the entry just played.
    const step = (delta, wrap) => {
        const seq = sequence();
        if (!seq.length) {
            return null;
        }
        const pos = current ? seq.indexOf(current) : -1;
        const target = pos + delta;
        if (target >= 0 && target < seq.length) {
            return seq[target];
        }
        if (!wrap) {
            return null;
        }
        if (order && delta > 0) {
            order = shuffled(entries);
            if (order.length > 1 && order[0] === current) {
                order.push(order.shift());
            }
            return order[0];
        }
        return seq[(target % seq.length + seq.length) % seq.length];
    };

    const replace = (list, first) => {
        entries = list.slice(0);
        current = first || entries[0] || null;
        if (order) {
            order = shuffled(entries, current);
        }
    };

    const has = entry => entries.includes(entry);

    // At the end of the queue (and of the shuffled order); false if present.
    const add = entry => {
        if (has(entry)) {
            return false;
        }
        entries.push(entry);
        if (order) {
            order.push(entry);
        }
        return true;
    };

    // Right after the current entry, moving it if it is already queued.
    const insertNext = entry => {
        if (entry === current) {
            return;
        }
        [entries, order].forEach(seq => {
            if (!seq) {
                return;
            }
            const idx = seq.indexOf(entry);
            if (idx !== -1) {
                seq.splice(idx, 1);
            }
            seq.splice(current ? seq.indexOf(current) + 1 : 0, 0, entry);
        });
    };

    // Returns the entry that becomes current when the current one is
    // removed: the one taking its place in the play order, else the first.
    const remove = entry => {
        const seq = sequence();
        const pos = seq.indexOf(entry);
        if (pos === -1) {
            return current;
        }
        entries.splice(entries.indexOf(entry), 1);
        if (order) {
            order.splice(pos, 1);
        }
        if (entry === current) {
            current = seq[pos] || seq[0] || null;
        }
        return current;
    };

    const clear = () => replace([]);

    return {
        get entries() {
            return entries.slice(0);
        },
        get current() {
            return current;
        },
        get length() {
            return entries.length;
        },
        get isShuffled() {
            return !!order;
        },
        select(entry) {
            if (has(entry)) {
                current = entry;
            }
        },
        add,
        insertNext,
        remove,
        replace,
        clear,
        setShuffle,
        next: wrap => step(1, wrap),
        previous: () => step(-1, true)
    };
};

module.exports = {
    createQueue
};
