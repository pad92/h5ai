const kjua = require('kjua');
const {isNum, dom} = require('../util');
const event = require('../core/event');
const format = require('../core/format');
const resource = require('../core/resource');
const allsettings = require('../core/settings');
const i18n = require('../core/i18n');
const store = require('../core/store');


const settings = Object.assign({
    enabled: false,
    show: false,
    qrcode: true,
    // Dark modules on a light background in both themes: many scanners do
    // not read inverted codes.
    qrFill: '#212121',
    qrBack: '#fff',
    qrFillDark: '#212121',
    qrBackDark: '#e0e0e0'
}, allsettings.info);
const tpl =
        `<div id="info">
            <div class="icon"><img src="${resource.blankImage}" alt=""/></div>
            <div class="block">
                <div class="label"></div>
                <div class="time"></div>
                <div class="size"></div>
                <div class="type"></div>
                <div class="content">
                    <span class="folders"></span> <span class="l10n-folders"></span>,
                    <span class="files"></span> <span class="l10n-files"></span>
                </div>
            </div>
            <div class="qrcode"/>
        </div>`;
const settingsTpl =
        `<div class="block">
            <h1 class="l10n-info">Info</h1>
            <button type="button" id="view-info" class="button view l10n_title-info" aria-pressed="false">
                <img class="l10n_alt-info" src="${resource.image('info-toggle')}" alt="Info"/>
            </button>
        </div>`;
const storekey = 'ext/info';
let $img;
let $label;
let $time;
let $size;
let $type;
let $content;
let $folders;
let $files;
let $qrcode;
let currentFolder;


const updateSettings = () => {
    if (store.get(storekey)) {
        dom('#view-info').addCls('active').attr('aria-pressed', 'true');
        dom('#info').show();
    } else {
        dom('#view-info').rmCls('active').attr('aria-pressed', 'false');
        dom('#info').hide();
    }
};

const update = item => {
    let src = item.thumbRational || item.icon;
    const isThumb = !!item.thumbRational;

    if (item.isCurrentFolder() || !src) {
        src = resource.icon('folder');
    }

    $img.attr('src', src);
    if (isThumb) {
        $img.addCls('thumb');
    } else {
        $img.rmCls('thumb');
    }

    $label.text(item.label);
    if (isNum(item.time)) {
        $time.text(format.formatDate(item.time));
    } else {
        $time.text('.');
    }

    if (isNum(item.size)) {
        $size.text(format.formatSize(item.size));
        $size.show();
    } else {
        $size.hide();
    }

    $type.text(item.type);

    if (item.isContentFetched) {
        const stats = item.getStats();
        $folders.text(stats.folders);
        $files.text(stats.files);
        $content.show();
    } else {
        $content.hide();
    }

    if (settings.qrcode) {
        const loc = global.window.location;
        const theme = document.body && document.body.getAttribute && document.body.getAttribute('data-theme');
        const qFill = theme === 'dark' ? settings.qrFillDark : settings.qrFill;
        const qBack = theme === 'dark' ? settings.qrBackDark : settings.qrBack;
        const qrImage = kjua({
            render: 'image',
            size: 200,
            fill: qFill,
            back: qBack,
            text: loc.protocol + '//' + loc.host + item.absHref,
            crisp: true,
            quiet: 1
        });
        // kjua creates the img without alt, which HTML requires.
        qrImage.setAttribute('alt', i18n.t('qrCode'));
        qrImage.classList.add('l10n_alt-qrCode');
        $qrcode.clr().app(qrImage);
    }
};

const onMouseenter = item => {
    update(item);
};

const onMouseleave = () => {
    update(currentFolder);
};

const onLocationChanged = item => {
    currentFolder = item;
    update(currentFolder);
};

const init = () => {
    if (!settings.enabled) {
        return;
    }

    const $info = dom(tpl).hide().appTo('#mainrow');
    $img = $info.find('.icon img');
    $label = $info.find('.label');
    $time = $info.find('.time');
    $size = $info.find('.size');
    $type = $info.find('.type');
    $content = $info.find('.content');
    $folders = $info.find('.folders');
    $files = $info.find('.files');
    $qrcode = $info.find('.qrcode');

    if (!settings.qrcode) {
        $qrcode.rm();
    }

    dom(settingsTpl)
        .appTo('#sidebar')
        .find('#view-info')
        .on('click', ev => {
            store.put(storekey, !store.get(storekey));
            updateSettings();
            event.pub('resize');
            ev.preventDefault();
        });

    // ensure stored value is boolean, otherwise set default
    if (typeof store.get(storekey) !== 'boolean') {
        store.put(storekey, settings.show);
    }
    updateSettings();

    event.sub('location.changed', onLocationChanged);
    event.sub('item.mouseenter', onMouseenter);
    event.sub('item.mouseleave', onMouseleave);
    // when theme changes, regenerate qr if visible
    event.sub('theme.changed', () => {
        // regenerate qr for current folder/item, if we have one
        if (currentFolder) {
            update(currentFolder);
        }
    });
};


init();
