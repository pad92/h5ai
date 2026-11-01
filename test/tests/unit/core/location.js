const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const config = reqlib('config');

config.setup = {PUBLIC_HREF: '/', ROOT_HREF: '/'};
config.theme = {};

const {forceEncoding} = reqlib('core/location');

test('location encoding preserves path separators and escapes reserved characters', () => {
    assert.equal(forceEncoding('/a b/c#d?e&f+g'), '/a%20b/c%23d%3Fe%26f%2Bg');
    assert.equal(forceEncoding('/a//b'), '/a/b');
    assert.equal(forceEncoding('/already%20encoded'), '/already%20encoded');
});

test('location sets links for managed folders and unmanaged files', () => {
    const managed = document.createElement('a');
    const unmanaged = document.createElement('a');
    const {dom} = require('../../../../src/_h5ai/public/js/lib/util/dom');

    reqlib('core/location').setLink(dom(managed), {
        absHref: '/folder/', isFolder: () => true, isManaged: true
    });
    reqlib('core/location').setLink(dom(unmanaged), {
        absHref: '/external/file.txt', isFolder: () => false, isManaged: false
    });
    assert.equal(managed.getAttribute('href'), '/folder/');
    assert.equal(managed.getAttribute('target'), null);
    assert.equal(unmanaged.getAttribute('href'), '/external/file.txt');
    assert.equal(unmanaged.getAttribute('target'), '_blank');
});

