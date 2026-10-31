const {test, assert} = require('scar');
const server = require('../../util/reqlib')('server');

test('download form submits the selected hrefs using form encoding', () => {
    const proto = window.HTMLFormElement.prototype;
    const submit = proto.submit;
    let submitted = false;
    proto.submit = function submitDownload() {
        submitted = true;
        assert.equal(this.method, 'post');
        assert.equal(this.enctype, 'application/x-www-form-urlencoded');
        const data = new window.FormData(this);
        assert.equal(data.get('action'), 'download');
        assert.equal(data.get('hrefs[0]'), '/a & b.txt');
        assert.equal(data.get('hrefs[1]'), '/nested/file.txt');
    };
    try {
        server.formRequest({action: 'download', 'hrefs[0]': '/a & b.txt', 'hrefs[1]': '/nested/file.txt'});
        assert.equal(submitted, true);
        assert.equal(document.querySelector('form'), null);
    } finally {
        proto.submit = submit;
    }
});
