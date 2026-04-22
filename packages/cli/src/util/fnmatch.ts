// Minimal port of Python fnmatch.fnmatchcase — shell-style glob matching.
// Supports: '*', '?', '[seq]', '[!seq]'. Case-sensitive by design.

export function fnmatchCase(name: string, pattern: string): boolean {
  return translate(pattern).test(name);
}

const CACHE = new Map<string, RegExp>();

function translate(pat: string): RegExp {
  const cached = CACHE.get(pat);
  if (cached) return cached;

  let i = 0;
  const n = pat.length;
  let res = '';
  while (i < n) {
    const c = pat[i];
    i += 1;
    if (c === '*') {
      res += '.*';
    } else if (c === '?') {
      res += '.';
    } else if (c === '[') {
      let j = i;
      if (j < n && pat[j] === '!') j += 1;
      if (j < n && pat[j] === ']') j += 1;
      while (j < n && pat[j] !== ']') j += 1;
      if (j >= n) {
        res += '\\[';
      } else {
        let stuff = pat.slice(i, j).replace(/\\/g, '\\\\');
        i = j + 1;
        if (stuff.startsWith('!')) {
          stuff = '^' + stuff.slice(1);
        } else if (stuff.startsWith('^')) {
          stuff = '\\' + stuff;
        }
        res += '[' + stuff + ']';
      }
    } else {
      res += (c as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  const re = new RegExp('^(?:' + res + ')$');
  CACHE.set(pat, re);
  return re;
}
