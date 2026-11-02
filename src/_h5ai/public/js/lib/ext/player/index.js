// The player bar: tracks play in it, videos in the preview, from one queue.
// It keeps the `preview-aud` option block, which existing options.json
// files use.
const {each, includes} = require('../../util');
const allsettings = require('../../core/settings');
const event = require('../../core/event');
const {createPlayer} = require('./player');
const memory = require('./memory');
const view = require('./view');

const settings = Object.assign({
    enabled: false,
    autoplay: true,
    types: ['aud']
}, allsettings['preview-aud']);
const videoSettings = Object.assign({
    types: []
}, allsettings['preview-vid']);

const player = createPlayer({audioTypes: settings.types, videoTypes: videoSettings.types});

const initItem = item => {
    if (!item.$view) {
        return;
    }
    // A video keeps its click on the preview; it only gets the row buttons.
    if (player.isVideo(item)) {
        view.addRowActions(item, player.rowActions);
        return;
    }
    if (player.isTrack(item)) {
        view.addRowActions(item, player.rowActions);
        // A click opens the player like a preview; autoplay decides whether
        // it also starts.
        const onclick = ev => {
            ev.preventDefault();
            player.playFolder(item, settings.autoplay);
        };
        if (item.click_callback) {
            item.$view.find('a').off('click', item.click_callback);
        }
        item.click_callback = onclick;
        item.click_callback.type = item.type;
        item.$view.find('a').on('click', onclick);
    } else if (item.click_callback && includes(settings.types, item.click_callback.type)) {
        item.$view.find('a').off('click', item.click_callback);
        delete item.click_callback;
    }
};

// The state saved by an earlier page. Exported for the tests; the page
// restores it once, on its first location, when the video preview has
// registered its types.
const restoreSaved = () => player.restore(memory.load());

const init = () => {
    if (!settings.enabled) {
        return;
    }
    player.init();
    const onFirstLocation = () => {
        event.unsub('location.changed', onFirstLocation);
        restoreSaved();
    };
    event.sub('location.changed', onFirstLocation);
    event.sub('view.changed', added => {
        each(added, initItem);
        player.refreshListing();
    });
    event.sub('item.changed', changed => {
        initItem(changed);
        player.refreshListing();
    });
};

init();

module.exports = {
    restoreSaved
};
