const {dom} = require('../util');
const server = require('../server');
const event = require('../core/event');
const resource = require('../core/resource');
const allsettings = require('../core/settings');
const {estimate, formatFigures} = require('./tasks-progress');

const win = global.window;
const settings = Object.assign({
    enabled: false,
    interval: 3000,
    idleInterval: 30000
}, allsettings.tasks);

// A listing may start the folder size worker: look again shortly after.
const AFTER_LISTING_DELAY = 1000;
// Task ids, in display order. The labels are l10n keys.
const TASKS = [
    {id: 'warmer', label: 'taskWarmer', text: 'cache warming'},
    {id: 'refresh', label: 'taskRefresh', text: 'folder sizes'},
    {id: 'thumbs', label: 'taskThumbs', text: 'thumbnails'}
];
const tpl =
        `<div id="tasks" class="tool" role="status" tabindex="0" aria-label="tasks in progress">
            <img src="${resource.image('tasks')}" alt="tasks"/>
        </div>`;
const panelTpl = `<div id="tasks-panel" class="hidden">${TASKS.map(task =>
    `<div class="task hidden" data-task="${task.id}">
        <div class="task-head"><span class="label l10n-${task.label}">${task.text}</span><span class="figures"></span></div>
        <div class="task-bar"><div class="task-fill"></div></div>
    </div>`).join('')}</div>`;

let $tasks;
let $panel;
let serverTasks = [];
let thumbs = null;
let timeoutId = null;


const currentTasks = () => {
    const tasks = serverTasks.slice(0);
    if (thumbs) {
        tasks.push(Object.assign({id: 'thumbs'}, estimate(thumbs.done, thumbs.total, thumbs.started, Date.now())));
    }
    return tasks;
};

const showPanel = () => {
    const rect = $tasks[0].getBoundingClientRect();
    $panel.css({left: `${Math.round(rect.left)}px`, top: `${Math.round(rect.bottom)}px`}).rmCls('hidden');
};

const hidePanel = () => {
    $panel.addCls('hidden');
};

const render = () => {
    const tasks = currentTasks();
    TASKS.forEach(({id}) => {
        const task = tasks.find(t => t.id === id);
        const $row = $panel.find(`[data-task="${id}"]`);
        if (!task) {
            $row.addCls('hidden');
            return;
        }
        $row.rmCls('hidden');
        if (task.percent === null) {
            $row.addCls('indeterminate');
        } else {
            $row.rmCls('indeterminate');
        }
        $row.find('.figures').text(formatFigures(task.percent, task.remaining));
        $row.find('.task-fill').css({width: `${task.percent || 0}%`});
    });

    if (tasks.length) {
        $tasks.show();
    } else {
        $tasks.hide();
        hidePanel();
    }
};

// Resolves to the delay before the next poll.
const poll = () => {
    if (win.document.hidden) {
        return Promise.resolve(settings.idleInterval);
    }
    return server.request({action: 'get', tasks: true})
        .then(response => {
            serverTasks = Array.isArray(response.tasks) ? response.tasks : [];
        })
        .catch(() => {
            serverTasks = [];
        })
        .then(() => {
            render();
            return serverTasks.length ? settings.interval : settings.idleInterval;
        });
};

const schedule = delay => {
    win.clearTimeout(timeoutId);
    timeoutId = win.setTimeout(() => poll().then(schedule), delay);
};

// Published by thumbnails.js: {done, total} of the thumbnails requested
// since the page last had none pending.
const onThumbsProgress = progress => {
    if (progress.done >= progress.total) {
        thumbs = null;
    } else {
        thumbs = Object.assign({started: thumbs ? thumbs.started : Date.now()}, progress);
    }
    render();
};

const init = () => {
    if (!settings.enabled) {
        return;
    }
    settings.interval = Math.max(1000, settings.interval);
    settings.idleInterval = Math.max(settings.interval, settings.idleInterval);

    $tasks = dom(tpl).hide().appTo('#toolbar')
        .on('mouseenter', showPanel)
        .on('mouseleave', hidePanel)
        .on('focus', showPanel)
        .on('blur', hidePanel);
    $panel = dom(panelTpl).appTo('body');

    event.sub('thumbs.progress', onThumbsProgress);
    event.sub('location.changed', () => schedule(AFTER_LISTING_DELAY));
    win.document.addEventListener('visibilitychange', () => {
        if (!win.document.hidden) {
            schedule(0);
        }
    });
    schedule(0);
};


init();
