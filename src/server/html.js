// Tiny HTML templating: every interpolated value is escaped unless it is already a
// SafeHtml (the result of another html`` call, or raw()). Launch names and taglines
// are third-party text, so escaping is the default rather than something to remember.

class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function render(value) {
  if (value == null || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/** Marks a string as already-safe markup. Only for text this codebase wrote. */
export function raw(value) {
  return new SafeHtml(String(value));
}

/** Only http(s) links to Product Hunt are ever rendered as launch links. */
export function launchUrl(url) {
  return /^https:\/\/www\.producthunt\.com\/[\w\-/.]+$/.test(url ?? '') ? url : null;
}
