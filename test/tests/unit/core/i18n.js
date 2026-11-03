const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');

const i18n = reqlib('core/i18n');
const event = reqlib('core/event');

// The checks on the language files read the disk: see test/node/l10n-files.js.

const fragment = html => {
    const el = document.createElement('div');
    el.innerHTML = html;
    return el;
};

// Restores English after a test that switched language.
const withLanguage = (table, run) => {
    try {
        i18n.set(table);
        run();
    } finally {
        i18n.set({});
    }
};

test('i18n: marked elements get their text, placeholder, title, aria-label and alt', () => {
    const el = fragment([
        '<h1 class="l10n-tree">x</h1>',
        '<input class="l10n_ph-search"/>',
        '<button class="l10n_title-shuffle l10n_aria-shuffle"></button>',
        '<img class="l10n_alt-download"/>'
    ].join(''));
    withLanguage({tree: 'Arborescence', search: 'rechercher', shuffle: 'Aléatoire'}, () => {
        i18n.apply(el);
        assert.equal(el.querySelector('h1').textContent, 'Arborescence');
        assert.equal(el.querySelector('input').getAttribute('placeholder'), 'rechercher');
        assert.equal(el.querySelector('button').getAttribute('title'), 'Aléatoire');
        assert.equal(el.querySelector('button').getAttribute('aria-label'), 'Aléatoire');
        assert.equal(el.querySelector('img').getAttribute('alt'), 'download', 'a key missing from the language falls back to English');
    });
});

test('i18n: a language change reaches the page and is announced', () => {
    const el = fragment('<span class="l10n-noTrack"></span>');
    document.body.appendChild(el);
    const seen = [];
    const listener = code => seen.push(code);
    event.sub('l10n.changed', listener);
    try {
        withLanguage({isoCode: 'de', noTrack: 'Kein Titel'}, () => {
            assert.equal(el.textContent, 'Kein Titel');
        });
        assert.equal(el.textContent, 'No Track', 'back to English');
        assert.deepEqual(seen, ['de', 'en']);
    } finally {
        event.unsub('l10n.changed', listener);
        el.remove();
    }
});

test('i18n: t() falls back to English and fills %s', () => {
    withLanguage({vizSwitch: '%s (cliquer pour changer)'}, () => {
        assert.equal(i18n.t('vizSwitch', 'Plasma'), 'Plasma (cliquer pour changer)');
        assert.equal(i18n.t('vizPlasma'), 'Plasma');
    });
    assert.equal(i18n.t('no-such-key'), 'no-such-key');
    assert.equal(i18n.t('vizSwitch', 'A $& B $$'), 'A $& B $$ (click to change)', 'an argument is inserted as is');
});

test('i18n: mark() swaps the key of a state label', () => {
    const btn = fragment('<button class="l10n_title-repeatOff l10n_aria-repeatOff"></button>').firstChild;
    i18n.mark(btn, 'repeatQueue', ['title', 'aria']);
    assert.equal(btn.getAttribute('title'), 'Repeat (Queue)');
    assert.equal(btn.className, 'l10n_title-repeatQueue l10n_aria-repeatQueue');
});

test('i18n: mark() with null keeps a language change off a shown name', () => {
    const el = fragment('<span class="l10n-noTrack"></span>').firstChild;
    i18n.apply(el);
    i18n.mark(el, null, ['text']);
    el.textContent = 'Some Song';
    withLanguage({noTrack: 'Aucune piste'}, () => {
        i18n.apply(el);
        assert.equal(el.textContent, 'Some Song');
    });
    assert.equal(el.className, '');
});
