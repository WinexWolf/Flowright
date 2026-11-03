const luhn = (digits: string) => { let sum = 0, alt = false; for (let i = digits.length - 1; i >= 0; i--) { let n = +digits[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; } return sum % 10 === 0; };

/**
 * Remove personal data and secrets from text BEFORE it can reach a model: emails, card numbers (Luhn-checked), JWTs, long opaque tokens/keys,
 * phone-like numbers and IPv4 addresses. Pattern-based, so it is a safety net, not a guarantee: still run against test data, never production.
 */
export function redact(text: string): string {
  return text
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[token]')
    .replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, '[email]')
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, m => (luhn(m.replace(/\D/g, '')) ? '[card]' : m))
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[secret]')
    .replace(/(?<![\w.])\+?\d[\d\s().-]{8,}\d(?![\w.])/g, m => { const n = m.replace(/\D/g, '').length; const formatted = /[\s().+-]/.test(m); return (formatted && n >= 9) || (!formatted && (n === 10 || n === 11)) ? '[phone]' : m; })
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]');
}
