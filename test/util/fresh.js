const reqlib = require('./reqlib');

const LIB = '../../src/_h5ai/public/js/lib/';

// Modules that run init() on require read their settings once, so each
// scenario loads its own copy. The event subscriptions made while loading are
// recorded and dropped by cleanup(), so they cannot leak into later tests.
// emit() calls only those subscriptions: modules loaded by other tests share
// the event bus and would react to a real publish.
const fresh = (name, settings = {}) => {
    const allsettings = reqlib('core/settings');
    const event = reqlib('core/event');
    const resolved = require.resolve(LIB + name);
    const saved = {};
    const subs = [];
    const original = require.cache[resolved];

    Object.keys(settings).forEach(key => {
        saved[key] = allsettings[key];
        allsettings[key] = settings[key];
    });

    const sub = event.sub;
    event.sub = (topic, listener) => {
        subs.push([topic, listener]);
        sub(topic, listener);
    };
    delete require.cache[resolved];
    try {
        require(resolved);
    } finally {
        event.sub = sub;
    }

    const cleanup = () => {
        subs.forEach(([topic, listener]) => event.unsub(topic, listener));
        Object.keys(saved).forEach(key => {
            allsettings[key] = saved[key];
        });
        // Modules loaded earlier keep the instance they required.
        if (original) {
            require.cache[resolved] = original;
        } else {
            delete require.cache[resolved];
        }
    };

    const emit = (topic, ...args) => subs
        .filter(([subTopic]) => subTopic === topic)
        .forEach(([, listener]) => listener.apply(topic, args));

    return {emit, cleanup};
};

// Lets pending promise callbacks and zero-delay timers run.
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

module.exports = {fresh, flush};
