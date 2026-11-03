// How a build's version reads in the page. scripts/version.sh gives either a
// release tag without its "v" (1.6.0, 1.7.0-rc.1) or a commit id (1fd0cb1e).
// Only a release gets the "v": "v1fd0cb1e" would read as a version number.
// Shared by the build (Pug pages) and the scripts, so both always agree.
const RELEASE_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const isRelease = version => RELEASE_RE.test(String(version || ''));

const versionLabel = version => {
    if (!version) {
        return '';
    }
    return isRelease(version) ? `v${version}` : String(version);
};

module.exports = {isRelease, versionLabel};
