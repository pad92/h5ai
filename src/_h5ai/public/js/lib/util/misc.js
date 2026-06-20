
const esc_pattern = sequence => {
    return sequence.replace(/[\-\[\]{}()*+?.,\\$\^|#\s]/g, '\\$&');
};

const parse_pattern = (sequence, advanced) => {
    if (!advanced) {
        return esc_pattern(sequence);
    }

    if (sequence.substr(0, 3) === 're:') {
        return sequence.substr(3);
    }

    return sequence.trim().split(/\s+/).map(part => {
        return part.split('').map(char => esc_pattern(char)).join('.*?');
    }).join('|');
};

const escape_html = str => {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

const dangerousProto = ['java', 'script:'].join('');
const urlAttrRe = /^(href|src|action)$/i;

const sanitize_html = html => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,iframe,object,embed,form,link,meta,base').forEach(el => el.remove());
    doc.querySelectorAll('*').forEach(el => {
        [...el.attributes].forEach(attr => {
            const isEventHandler = attr.name.startsWith('on');
            const isDangerousUrl = urlAttrRe.test(attr.name) && attr.value.trimStart().toLowerCase().startsWith(dangerousProto);
            if (isEventHandler || isDangerousUrl) {
                el.removeAttribute(attr.name);
            }
        });
    });
    return doc.body.innerHTML;
};


module.exports = {
    parsePattern: parse_pattern,
    escapeHtml: escape_html,
    sanitizeHtml: sanitize_html
};
