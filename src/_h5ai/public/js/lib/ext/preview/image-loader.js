const loadImage = (href, size, requestSample, createImage) => {
    return createImage(href).catch(err => {
        if (!size) {
            throw new Error('unable to load image', {cause: err});
        }
        return requestSample(href).then(sample => {
            if (!sample) {
                throw new Error('unable to load image sample', {cause: err});
            }
            return createImage(sample);
        });
    });
};

module.exports = {loadImage};
