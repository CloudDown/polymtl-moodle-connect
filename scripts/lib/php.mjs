/**
 * A small, tolerant parser for the PHP literals that Moodle's web service
 * definitions are written in. We only need enough PHP to read
 * `db/services.php` registries and `execute_parameters()` / `execute_returns()`
 * schema declarations, so this is deliberately not a general PHP parser.
 */

/** Strips // and slash-star comments, preserving string literals verbatim. */
export function stripPhpComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src.slice(i, i + 2);
    if (c2 === "//") {
      while (i < n && src[i] !== "\n") i++;
    } else if (c2 === "/*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
    } else if (c === "'" || c === '"') {
      const [, next] = readPhpString(src, i);
      out += src.slice(i, next);
      i = next;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * Returns the text between a bracket pair starting at src[open], which must be
 * '(' or '['.
 */
export function balanced(src, open) {
  if (src[open] !== "(" && src[open] !== "[") {
    throw new Error(`expected ( or [ at ${open}, got ${JSON.stringify(src[open])}`);
  }
  let depth = 0;
  let i = open;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "'" || c === '"') {
      const [, next] = readPhpString(src, i);
      i = next;
      continue;
    }
    if (c === "(" || c === "[") {
      depth++;
    } else if (c === ")" || c === "]") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
    i++;
  }
  throw new Error("unbalanced brackets");
}

/**
 * Reads a single PHP string literal at src[i]. Returns [value, indexAfter].
 */
export function readPhpString(src, i) {
  const quote = src[i];
  if (quote !== "'" && quote !== '"') {
    throw new Error(`expected string at ${i}, got ${JSON.stringify(src[i])}`);
  }
  let j = i + 1;
  let out = "";
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") {
      const next = src[j + 1];
      if (quote === "'") {
        out += next === "'" || next === "\\" ? next : "\\" + next;
      } else {
        out += { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", $: "$" }[next] ?? next;
      }
      j += 2;
      continue;
    }
    if (c === quote) return [out, j + 1];
    out += c;
    j++;
  }
  throw new Error("unterminated string");
}

/** Finds the index of the ']' matching the '[' at `open`, string aware. */
function findArrayEnd(src, open) {
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"') {
      const [, next] = readPhpString(src, i);
      i = next;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

/** Matches an `array(` literal opener at src[i]; returns the index of its '('. */
function arrayOpener(src, i) {
  const m = /^array\s*\(/.exec(src.slice(i, i + 12));
  return m ? i + m[0].length - 1 : -1;
}

/**
 * Parses a comma separated list of PHP values (function call arguments).
 * Returns [{kind:"string"|"raw"|"array"|"new", ...}].
 */
export function parseValueList(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    while (i < n && (src[i] === "," || /\s/.test(src[i]))) i++;
    if (i >= n) break;
    if (src[i] === "'" || src[i] === '"') {
      const [value, next] = readPhpString(src, i);
      i = next;
      out.push({ kind: "string", value });
    } else if (src[i] === "[") {
      const end = findArrayEnd(src, i);
      if (end === -1) break;
      out.push({ kind: "array", raw: src.slice(i, end) });
      i = end;
    } else if (arrayOpener(src, i) !== -1) {
      const open = arrayOpener(src, i);
      const body = balanced(src, open);
      out.push({ kind: "array", raw: src.slice(i, open + body.length + 2) });
      i = open + body.length + 2;
    } else if (src.startsWith("new ", i) || src.startsWith("new\t", i)) {
      const m = /^new\s+([A-Za-z0-9_\\]+)\s*\(/.exec(src.slice(i));
      if (!m) {
        const end = findValueEnd(src, i);
        out.push({ kind: "raw", raw: src.slice(i, end).trim() });
        i = end;
        continue;
      }
      const open = i + m[0].length - 1;
      const args = balanced(src, open);
      out.push({ kind: "new", class: m[1].replace(/^.*\\/, ""), args: parseValueList(args) });
      i = open + args.length + 2;
    } else {
      const end = findValueEnd(src, i);
      out.push({ kind: "raw", raw: src.slice(i, end).trim() });
      i = end;
    }
  }
  return out;
}

/** Index just past the end of a bare (non string, non bracket) value. */
function findValueEnd(src, start) {
  let i = start;
  while (i < src.length) {
    const c = src[i];
    if (c === ",") break;
    if (c === "'" || c === '"') {
      const [, next] = readPhpString(src, i);
      i = next;
      continue;
    }
    if (c === "(") {
      i += balanced(src, i).length + 2;
      continue;
    }
    if (c === "[") {
      i = findArrayEnd(src, i);
      continue;
    }
    i++;
  }
  return i;
}

/**
 * Parses a PHP array of `'key' => <expr>` entries. Accepts the array body with
 * or without its surrounding brackets. Returns [key, value] pairs.
 */
export function parsePhpEntries(src) {
  const entries = [];
  const n = src.length;
  let i = 0;
  const skipWs = () => {
    while (i < n && /\s/.test(src[i])) i++;
  };
  skipWs();
  if (src[i] === "[") i++;
  else if (arrayOpener(src, i) !== -1) i = arrayOpener(src, i) + 1;
  let guard = 0;
  while (i < n && guard++ < 100000) {
    skipWs();
    if (i >= n || src[i] === "]") break;
    if (src[i] === ",") {
      i++;
      continue;
    }
    let key;
    if (src[i] === "'" || src[i] === '"') {
      const parsed = readPhpString(src, i);
      key = parsed[0];
      i = parsed[1];
    } else {
      const start = i;
      while (i < n && /[A-Za-z0-9_]/.test(src[i])) i++;
      key = src.slice(start, i);
    }
    skipWs();
    if (src[i] !== "=" || src[i + 1] !== ">") {
      i = findValueEnd(src, i);
      continue;
    }
    i += 2;
    skipWs();
    let value;
    if (src[i] === "'" || src[i] === '"') {
      const parsed = readPhpString(src, i);
      value = { kind: "string", value: parsed[0] };
      i = parsed[1];
    } else if (src[i] === "[") {
      const end = findArrayEnd(src, i);
      value = { kind: "array", raw: src.slice(i, end) };
      i = end;
    } else if (arrayOpener(src, i) !== -1) {
      const open = arrayOpener(src, i);
      const body = balanced(src, open);
      const end = open + body.length + 2;
      value = { kind: "array", raw: src.slice(i, end) };
      i = end;
    } else if (src.startsWith("new ", i) || src.startsWith("new\t", i)) {
      const m = /^new\s+([A-Za-z0-9_\\]+)\s*\(/.exec(src.slice(i));
      if (!m) {
        const end = findValueEnd(src, i);
        value = { kind: "raw", raw: src.slice(i, end).trim() };
        i = end;
      } else {
        const open = i + m[0].length - 1;
        const args = balanced(src, open);
        value = { kind: "new", class: m[1].replace(/^.*\\/, ""), args: parseValueList(args) };
        i = open + args.length + 2;
      }
    } else {
      const end = findValueEnd(src, i);
      value = { kind: "raw", raw: src.slice(i, end).trim() };
      i = end;
    }
    entries.push([key, value]);
  }
  return entries;
}

/** Returns the body of `function <name>(...) { ... }` starting in `src`. */
export function extractMethodBody(src, method) {
  const m = new RegExp(`function\\s+${method}\\s*\\(`).exec(src);
  if (!m) return null;
  const open = src.indexOf("(", m.index + m[0].length - 1);
  let args;
  try {
    args = balanced(src, open);
  } catch {
    return null;
  }
  const bodyStart = src.indexOf("{", open + args.length + 1);
  if (bodyStart === -1) return null;
  let depth = 0;
  let i = bodyStart;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"') {
      const [, next] = readPhpString(src, i);
      i = next;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(bodyStart + 1, i);
    }
    i++;
  }
  return null;
}
