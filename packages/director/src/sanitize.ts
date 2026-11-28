/** Typed-answer sanitizer (T021). The validator is the real defense; this keeps junk out of prompts. */
export const MAX_TYPED_LEN = 120;

export interface Sanitized {
  /** cleaned text ('' if nothing usable remains) */
  text: string;
  /** `<player_text>...</player_text>` or '' when empty */
  wrapped: string;
  flags: string[];
}

const PROFANITY = ['fuck', 'shit', 'bitch', 'asshole', 'cunt', 'dick', 'bastard', 'slut', 'whore', 'nigger', 'faggot'];
// control chars, zero-width, bidi overrides/isolates, BOM, line/paragraph separators
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;
const URL_LIKE = /(?:https?:\/\/|ftp:\/\/|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|io|gg|ly|co|me|app|dev|xyz|ru|cn|info|biz|link|to)\b(?:\/\S*)?|\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi;

export function sanitizeTyped(input: unknown, maxLen = MAX_TYPED_LEN): Sanitized {
  const flags: string[] = [];
  let t = typeof input === 'string' ? input : '';
  if (typeof input !== 'string') flags.push('not_a_string');
  t = t.normalize('NFKC');
  const before = t;
  t = t.replace(INVISIBLE, ' ');
  if (t !== before) flags.push('control_chars');
  if (/[<>]/.test(t)) {
    t = t.replace(/[<>]/g, ' ');
    flags.push('angle_brackets');
  }
  if (/[{}]/.test(t)) {
    t = t.replace(/[{}]/g, ' ');
    flags.push('braces');
  }
  if (URL_LIKE.test(t)) {
    t = t.replace(URL_LIKE, ' ');
    flags.push('link');
  }
  URL_LIKE.lastIndex = 0;
  for (const w of PROFANITY) {
    const re = new RegExp(w, 'gi');
    if (re.test(t)) {
      t = t.replace(new RegExp(w, 'gi'), '*'.repeat(w.length));
      if (!flags.includes('profanity')) flags.push('profanity');
    }
  }
  t = t.replace(/\s+/g, ' ').trim();
  const chars = Array.from(t);
  if (chars.length > maxLen) {
    t = chars.slice(0, maxLen).join('').trim();
    flags.push('truncated');
  }
  return { text: t, wrapped: t ? `<player_text>${t}</player_text>` : '', flags };
}
