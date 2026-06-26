
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

// Allowlist-based HTML sanitizer for rendered Markdown / custom header-footer content.
// An allowlist is used (rather than a blocklist) because hand-rolled blocklists are
// notoriously bypassable (e.g. "java\tscript:", data: URIs, xlink:href, srcset, style).
const ALLOWED_TAGS = new Set([
    'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup', 'dd', 'del',
    'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
    'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'small', 'span',
    'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
]);

// Elements that must be dropped together with their content.
const FORBIDDEN_TAGS = new Set([
    'script', 'style', 'svg', 'math', 'iframe', 'object', 'embed', 'form', 'link', 'meta',
    'base', 'template', 'noscript', 'frame', 'frameset', 'applet', 'param', 'audio', 'video', 'source'
]);

const ALLOWED_ATTR = new Set([
    'href', 'src', 'alt', 'title', 'class', 'id', 'align', 'colspan', 'rowspan', 'span',
    'width', 'height', 'lang', 'dir', 'start', 'type', 'datetime', 'cite'
]);

const URL_ATTR = new Set(['href', 'src', 'cite']);

// Strip control chars and whitespace so "java\tscript:" / " javascript:" cannot slip through.
// eslint-disable-next-line no-control-regex -- stripping control chars is the intent
const strip_for_scheme = s => s.replace(/[\u0000-\u0020\u00a0]+/g, '');
const SAFE_DATA_IMG_RE = /^data:image\/(?:png|jpe?g|gif|webp);base64,/i;

const is_safe_url = (value, attr) => {
    const collapsed = strip_for_scheme(value);
    const scheme = collapsed.toLowerCase().match(/^([a-z][a-z0-9+.-]*):/);
    if (!scheme) {
        // relative path, anchor (#...), query (?...) or protocol-relative (//host)
        return true;
    }
    const name = scheme[1];
    if (name === 'http' || name === 'https' || name === 'mailto' || name === 'tel') {
        return true;
    }
    // Only inline raster images via data: URIs, never data:text/html or data:image/svg+xml.
    return attr === 'src' && SAFE_DATA_IMG_RE.test(collapsed);
};

const sanitize_html = html => {
    const doc = new DOMParser().parseFromString(String(html), 'text/html');

    // Snapshot the node list up front: unwrapping mutates the tree as we go.
    for (const el of [...doc.body.querySelectorAll('*')]) {
        const tag = el.tagName.toLowerCase();

        if (FORBIDDEN_TAGS.has(tag)) {
            el.remove();
            continue;
        }
        if (!ALLOWED_TAGS.has(tag)) {
            // Unknown but non-dangerous tag: drop the element, keep its (still-processed) children.
            el.replaceWith(...el.childNodes);
            continue;
        }

        for (const attr of [...el.attributes]) {
            const name = attr.name.toLowerCase();
            const allowed = ALLOWED_ATTR.has(name) && !name.startsWith('on');
            const unsafeUrl = URL_ATTR.has(name) && !is_safe_url(attr.value, name);
            if (!allowed || unsafeUrl) {
                el.removeAttribute(attr.name);
            }
        }
    }

    return doc.body.innerHTML;
};


module.exports = {
    parsePattern: parse_pattern,
    escapeHtml: escape_html,
    sanitizeHtml: sanitize_html
};
