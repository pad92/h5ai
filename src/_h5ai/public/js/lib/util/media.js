const addUnloadFn = el => {
    const originalUnload = el.unload;
    el.unload = () => {
        if (typeof originalUnload === 'function') {
            try {
                originalUnload.call(el);
            } catch {/* ignore */}
        }
        try {
            el.pause();
        } catch {/* ignore */}
        el.removeAttribute('src');

        if (el.tagName.toLowerCase() !== 'movi-player') {
            try {
                el.src = '';
                el.load();
            } catch {/* ignore */}
        }
    };
};

module.exports = {addUnloadFn};
