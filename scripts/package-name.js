// File name of the release archive. The version may be a branch name in CI
// ("fix/foo"), which is shown as-is in h5ai but must not create folders or
// odd characters in the archive name the Dockerfile copies (h5ai-*.zip).
const packageFileName = (name, version) => `${name}-${String(version).replace(/[^\w.+~-]+/g, '-')}.zip`;

module.exports = {packageFileName};
