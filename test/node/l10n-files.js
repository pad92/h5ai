// Checks on the language files and the interface sources. They read the disk,
// so scripts/run-tests.js loads them after test/index.js, which webpack also
// bundles for the browser, where fs does not exist.
const fs = require('fs');
const path = require('path');
const {test, assert} = require('scar');
const reqlib = require('../util/reqlib');

const i18n = reqlib('core/i18n');

const ROOT = path.join(__dirname, '..', '..');
const L10N_DIR = path.join(ROOT, 'src', '_h5ai', 'private', 'conf', 'l10n');
const LIB_DIR = path.join(ROOT, 'src', '_h5ai', 'public', 'js', 'lib');

// Languages kept complete: every new key is translated in them as it lands.
// The others may lack keys, which then read in English.
const MAINTAINED = ['de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt-br', 'pt-pt', 'ru', 'zh-cn', 'zh-tw'];

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const english = () => readJson(path.join(L10N_DIR, 'en.json'));
const languages = () => fs.readdirSync(L10N_DIR)
    .filter(name => name.endsWith('.json'))
    .map(name => [name.slice(0, -'.json'.length), readJson(path.join(L10N_DIR, name))]);

test('l10n files: en.json holds exactly the English defaults', () => {
    const json = english();
    const defaults = Object.assign({}, i18n.defaults);
    delete defaults.isoCode;
    assert.deepEqual(Object.keys(json).sort(), Object.keys(defaults).sort());
    Object.keys(json).forEach(key => assert.equal(json[key], defaults[key], key));
});

test('l10n files: every language uses known keys, non-empty, keeping %s', () => {
    const en = english();
    const keys = Object.keys(en);
    languages().forEach(([code, table]) => {
        assert.deepEqual(Object.keys(table).filter(key => !keys.includes(key)), [], `${code} has unknown keys`);
        Object.entries(table).forEach(([key, value]) => {
            assert.ok(typeof value === 'string' && value.trim(), `${code}.${key} is a non-empty string`);
            const holes = str => (str.match(/%s/g) || []).length;
            assert.equal(holes(value), holes(en[key]), `${code}.${key} keeps its %s`);
        });
    });
});

test('l10n files: maintained languages translate every key', () => {
    const keys = Object.keys(english());
    const tables = new Map(languages());
    MAINTAINED.forEach(code => {
        assert.ok(tables.has(code), `${code}.json exists`);
        const table = tables.get(code);
        assert.deepEqual(keys.filter(key => !Object.hasOwn(table, key)), [], `${code} lacks keys`);
    });
});

// Interface templates may not carry visible English: every literal title,
// aria-label, alt or element text needs the matching l10n class. The info
// page (main/) is for administrators and stays in English.
const listSources = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
        return entry.name === 'main' ? [] : listSources(file);
    }
    return entry.name.endsWith('.js') ? [file] : [];
});

test('l10n files: interface templates carry no untranslated English', () => {
    const problems = [];
    listSources(LIB_DIR).forEach(file => {
        const src = fs.readFileSync(file, 'utf8');
        const where = index => `${path.relative(LIB_DIR, file)}:${src.slice(0, index).split('\n').length}`;
        const attrs = {title: 'l10n_title-', 'aria-label': 'l10n_aria-', alt: 'l10n_alt-'};
        for (const tag of src.matchAll(/<[a-z][\w-]*\s[^<>]*>/g)) {
            Object.entries(attrs).forEach(([attr, prefix]) => {
                const match = new RegExp(`\\s${attr}="([^"]*)"`).exec(tag[0]);
                if (match && (/[A-Za-z]{2}/).test(match[1]) && !match[1].includes('${') && !tag[0].includes(prefix)) {
                    problems.push(`${where(tag.index)} ${attr}="${match[1]}"`);
                }
            });
        }
        for (const element of src.matchAll(/<([a-z][\w-]*)([^<>]*)>([^<>]*[A-Za-z]{2}[^<>]*)<\/\1>/g)) {
            // Entities (&times;) and acronyms (ISO) read the same everywhere.
            const text = element[3].replace(/&\w+;/g, '').trim();
            if ((/[a-z]{2}/).test(text) && !text.includes('${') && !element[2].includes('l10n-')) {
                problems.push(`${where(element.index)} <${element[1]}>${text}`);
            }
        }
    });
    assert.deepEqual(problems, []);
});
