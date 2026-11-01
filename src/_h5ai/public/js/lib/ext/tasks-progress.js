// Progress figures of the toolbar task indicator, kept free of DOM access.

// Below this fraction an extrapolated remaining time is mostly noise.
const MIN_PROGRESS = 0.01;

// {percent, remaining} of a task that did `done` of `total` items since
// `started` (ms). Either value is null while unknown. A task is never shown
// as complete: it disappears when it is.
const estimate = (done, total, started, now) => {
    if (!(total > 0)) {
        return {percent: null, remaining: null};
    }
    const progress = Math.min(done / total, 0.99);
    if (progress < MIN_PROGRESS) {
        return {percent: 0, remaining: null};
    }
    const elapsed = Math.max(1, (now - started) / 1000);
    return {
        percent: Math.floor(progress * 100),
        remaining: Math.round(elapsed / progress - elapsed)
    };
};

// "42 %" and "~ 3 min", or an ellipsis while unknown.
const formatPercent = percent => {
    return percent === null || percent === undefined ? '…' : `${percent} %`;
};

const formatRemaining = seconds => {
    if (seconds === null || seconds === undefined || seconds < 0) {
        return '…';
    }
    if (seconds < 60) {
        return `~ ${Math.max(1, Math.round(seconds))} s`;
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `~ ${minutes} min`;
    }
    return `~ ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
};

// "42 % · ~ 3 min", or a single ellipsis when nothing can be estimated.
const formatFigures = (percent, remaining) => {
    const isUnknown = value => value === null || value === undefined;
    if (isUnknown(percent) && isUnknown(remaining)) {
        return '…';
    }
    return `${formatPercent(percent)} · ${formatRemaining(remaining)}`;
};

module.exports = {
    estimate,
    formatFigures,
    formatPercent,
    formatRemaining
};
