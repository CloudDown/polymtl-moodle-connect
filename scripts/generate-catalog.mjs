#!/usr/bin/env node
/**
 * Generates catalog/functions.json from a Moodle source tree.
 *
 * Why this exists: a Moodle web service token advertises which functions you may
 * call (via core_webservice_get_site_info) but never their parameters. An agent
 * handed only a function name cannot call it. Moodle ships that missing half in
 * its own source tree:
 *
 *   1. <plugin>/db/services.php - the authoritative registry: exact wsfunction
 *      name, description, type (read/write), required capabilities, services.
 *   2. the class file named by that registry - execute_parameters() holds the
 *      input schema, execute_returns() the output shape.
 *
 * Usage:
 *   node scripts/generate-catalog.mjs <moodle-root> [outfile]
 *
 * The generated file is committed, so end users never run this.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { balanced, extractMethodBody, parsePhpEntries, stripPhpComments } from "./lib/php.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[3] ?? join(HERE, "..", "catalog", "functions.json");

// Moodle 5.x ships the web root under public/, 4.x does not.
let ROOT = (process.argv[2] ?? "").replace(/\/$/, "");
if (!ROOT) {
  console.error("usage: generate-catalog.mjs <moodle-root> [outfile]");
  process.exit(2);
}
if (!existsSync(join(ROOT, "version.php")) && existsSync(join(ROOT, "public", "version.php"))) {
  ROOT = join(ROOT, "public");
}
if (!existsSync(join(ROOT, "version.php"))) {
  console.error(`not a Moodle root (no version.php): ${ROOT}`);
  process.exit(2);
}

// ---------------------------------------------------------------- type mapping

const PARAM_TYPES = {
  PARAM_INT: "integer",
  PARAM_INTEGER: "integer",
  PARAM_TIMESTAMP: "integer",
  PARAM_FLOAT: "number",
  PARAM_BOOL: "boolean",
  PARAM_SEQUENCE: "array",
  PARAM_ARRAY: "array",
};

/** Describes one external_value / external_* declaration. */
function describeEntry(value) {
  if (value.kind === "new") {
    const { class: cls, args } = value;
    if (cls === "external_value") {
      const raws = args.filter((a) => a.kind === "raw").map((a) => a.raw);
      const typeConst = raws[0] ?? "PARAM_RAW";
      const desc = args.find((a) => a.kind === "string")?.value ?? "";
      const optional = raws.some((r) => r.startsWith("VALUE_DEFAULT") || r === "VALUE_OPTIONAL" || r === "VALUE_CLAMP");
      const nullable = raws.some((r) => r === "null");
      return {
        type: PARAM_TYPES[typeConst] ?? "string",
        raw: typeConst,
        description: desc.replace(/\s+/g, " ").trim(),
        ...(optional ? { optional: true } : {}),
        ...(nullable ? { nullable: true } : {}),
      };
    }
    if (cls === "external_multiple_structure") {
      const items = asEntries(args[0]);
      const optional = args.some((arg) => arg.kind === "raw" && /\bVALUE_(?:DEFAULT|OPTIONAL)\b/.test(arg.raw));
      const result = items.length
        ? { type: "array", items: describeEntries(items) }
        : { type: "array", items: describeEntry(args[0]) };
      return { ...result, ...(optional ? { optional: true } : {}) };
    }
    if (cls === "external_single_structure") {
      const optional = args.some((arg) => arg.kind === "raw" && /\bVALUE_(?:DEFAULT|OPTIONAL)\b/.test(arg.raw));
      return { type: "object", properties: describeEntries(asEntries(args[0])), ...(optional ? { optional: true } : {}) };
    }
    if (cls === "external_description") {
      return {
        type: "string",
        description: args
          .filter((a) => a.kind === "string")
          .map((a) => a.value)
          .join(" "),
        optional: true,
      };
    }
    return { type: "object", note: cls };
  }
  if (value.kind === "array") {
    return { type: "object", properties: describeEntries(asEntries(value)) };
  }
  return { type: "string", note: value.raw };
}

/**
 * Normalises the many ways a constructor argument can carry key => value pairs:
 * an already-parsed entry list, a raw `array(...)`/`[...]` literal, or a nested
 * `new external_single_structure(...)` wrapping one of those.
 */
function asEntries(node) {
  if (Array.isArray(node)) return node;
  if (!node || typeof node !== "object") return [];
  if (node.kind === "array") return parsePhpEntries(node.raw);
  if (node.kind === "new") return node.args.length ? asEntries(node.args[0]) : [];
  return [];
}

function describeEntries(entries) {
  const props = {};
  for (const [key, value] of entries) props[key] = describeEntry(value);
  return props;
}

// ------------------------------------------------------------ source walking

const SKIP_DIRS = new Set(["node_modules", ".git", "lang", "tests", "docs", "pix", "amd", "data", "upgrade"]);

function walk(dir, match, acc = [], depth = 0) {
  if (depth > 8) return acc;
  let listing;
  try {
    listing = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const d of listing) {
    const full = join(dir, d.name);
    if (d.isDirectory()) {
      if (SKIP_DIRS.has(d.name)) continue;
      walk(full, match, acc, depth + 1);
    } else if (match(d.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function readVersion() {
  const src = readFileSync(join(ROOT, "version.php"), "utf8");
  const pick = (k) => {
    const m = new RegExp(`\\$${k}\\s*=\\s*'?([^';]+)`).exec(src);
    return m ? m[1].trim() : null;
  };
  return { version: pick("version"), release: pick("release"), branch: pick("branch") };
}

const version = readVersion();
console.error(`Moodle ${version.version} (${version.release}) ${version.branch ?? ""}`);

// ------------------------------------------------------------------- registry

const servicesFiles = walk(ROOT, (n) => n === "services.php");
console.error(`scanned ${servicesFiles.length} services.php`);

const registry = new Map();
for (const file of servicesFiles) {
  const rel = file.slice(ROOT.length + 1);
  const raw = stripPhpComments(readFileSync(file, "utf8"));
  const start = raw.indexOf("$functions");
  if (start === -1) continue;
  // Registries are written as both `$functions = [` and `$functions = array(`.
  const eq = raw.indexOf("=", start);
  const openMatch = /[([]/.exec(raw.slice(eq, eq + 40));
  if (!openMatch) continue;
  const open = eq + openMatch.index;
  let body;
  try {
    body = balanced(raw, open);
  } catch (err) {
    console.error(`  skip ${rel}: ${err.message}`);
    continue;
  }
  for (const [name, value] of parsePhpEntries(body)) {
    if (value.kind !== "array") continue;
    const props = new Map();
    for (const [k, v] of parsePhpEntries(value.raw)) {
      if (v.kind === "string" || v.kind === "raw") props.set(k, v.kind === "string" ? v.value : v.raw);
      if (v.kind === "new") props.set(k, "@" + v.class);
    }
    const services = [...new Set([...value.raw.matchAll(/MOODLE_[A-Z_]*SERVICE/g)].map((m) => m[0]))];
    registry.set(name, {
      name,
      classname: props.get("classname") ?? null,
      methodname: props.get("methodname") ?? null,
      classpath: props.get("classpath") ?? null,
      description: (props.get("description") ?? "").replace(/\s+/g, " ").trim(),
      type: props.get("type") === "write" ? "write" : "read",
      capabilities: (props.get("capabilities") ?? "").trim() || null,
      deprecated: props.has("deprecated"),
      services,
      registryFile: rel,
    });
  }
}
console.error(`registry entries: ${registry.size}`);

// -------------------------------------------------------------- class lookup

const classIndex = new Map();
console.error("indexing classes...");
for (const file of walk(ROOT, (n) => n.endsWith(".php"), [], 0)) {
  let src;
  try {
    src = stripPhpComments(readFileSync(file, "utf8"));
  } catch {
    continue;
  }
  const ns = /^namespace\s+([A-Za-z0-9_\\]+)\s*;/m.exec(src);
  const cm = /^(?:abstract\s+|final\s+)?class\s+([A-Za-z0-9_]+)/m.exec(src);
  if (!cm) continue;
  if (ns) classIndex.set(`${ns[1].trim()}\\${cm[1]}`, file);
  const short = cm[1];
  if (!classIndex.has(short)) classIndex.set(short, file);
}
console.error(`indexed ${classIndex.size} classes`);

function resolveClassFile(entry) {
  if (entry.classpath) {
    const p = join(ROOT, entry.classpath);
    if (existsSync(p)) return p;
  }
  const cn = entry.classname;
  if (!cn) return null;
  if (cn.includes("\\")) {
    const parts = cn.split("\\");
    const cls = parts.pop();
    const component = parts[0];
    const base = component.startsWith("mod_") ? ["mod", component.slice(4)] : [component];
    const p = join(ROOT, ...base, "classes", ...parts.slice(1).map((s) => s.toLowerCase()), `${cls.toLowerCase()}.php`);
    if (existsSync(p)) return p;
    const byIndex = classIndex.get(cn);
    if (byIndex) return byIndex;
  }
  const short = cn.split("\\").pop();
  const modm = /^mod_([a-z0-9]+)_external$/.exec(short);
  if (modm) {
    for (const cand of [join(ROOT, "mod", modm[1], "classes", "external.php"), join(ROOT, "mod", modm[1], "externallib.php")]) {
      if (existsSync(cand)) return cand;
    }
  }
  return classIndex.get(short) ?? null;
}

/** Follow simple `return self::other_parameters()` schema delegation. */
function schemaBody(src, method, suffix) {
  let name = method ? `${method}_${suffix}` : `execute_${suffix}`;
  for (let depth = 0; depth < 4; depth++) {
    const body = extractMethodBody(src, name);
    if (!body) return null;
    if (body.includes("new external_")) return body;
    const delegate = /return\s+(?:self|static)::([A-Za-z0-9_]+)\s*\(/.exec(body);
    if (!delegate) return body;
    name = delegate[1];
  }
  return null;
}

// ------------------------------------------------------------------- harvest

const functions = [];
let withParams = 0;
let withReturns = 0;
let unresolved = 0;
const failures = [];

for (const entry of registry.values()) {
  const record = {
    name: entry.name,
    type: entry.type,
    description: entry.description,
    parameters: {},
    returns: null,
    ...(entry.capabilities ? { capabilities: entry.capabilities } : {}),
    ...(entry.services.length ? { services: entry.services } : {}),
    ...(entry.deprecated ? { deprecated: true } : {}),
  };

  const file = resolveClassFile(entry);
  if (file) {
    record.source = file.slice(ROOT.length + 1);
    let src = "";
    try {
      src = stripPhpComments(readFileSync(file, "utf8"));
    } catch {
      /* empty */
    }
    // Modern classes (namespaced, Moodle 3.9+) use execute_parameters(); the
    // legacy single-class-per-component style in externallib.php prefixes the
    // schema methods with the web service method name instead.
    const method = entry.methodname ?? "";
    const paramBody = schemaBody(src, method, "parameters") ?? schemaBody(src, "execute", "parameters");
    if (paramBody) {
      const ctor = paramBody.indexOf("new external_function_parameters");
      if (ctor !== -1) {
        try {
          // The first '(' after `new` opens this constructor's argument list.
          const args = balanced(paramBody, paramBody.indexOf("(", ctor));
          record.parameters = describeEntries(parsePhpEntries(args));
          withParams++;
        } catch (err) {
          failures.push(`${entry.name}: parameters: ${err.message}`);
        }
      }
    }
    const returnBody = schemaBody(src, method, "returns") ?? schemaBody(src, "execute", "returns");
    if (returnBody) {
      const ctor = returnBody.indexOf("new external_single_structure");
      if (ctor !== -1) {
        try {
          const args = balanced(returnBody, returnBody.indexOf("(", ctor));
          record.returns = describeEntries(parsePhpEntries(args));
          withReturns++;
        } catch (err) {
          failures.push(`${entry.name}: returns: ${err.message}`);
        }
      }
    }
  } else {
    unresolved++;
  }
  functions.push(record);
}

functions.sort((a, b) => a.name.localeCompare(b.name));

const payload = {
  generator: "scripts/generate-catalog.mjs",
  moodle: version,
  count: functions.length,
  read: functions.filter((f) => f.type === "read").length,
  write: functions.filter((f) => f.type === "write").length,
  functions,
};

writeFileSync(OUT, JSON.stringify(payload, null, 1) + "\n");
console.error(
  `\nwrote ${OUT}\n  functions:   ${functions.length} (read ${payload.read} / write ${payload.write})\n` +
    `  parameters:  ${withParams} resolved\n  returns:     ${withReturns} resolved\n` +
    `  no class:    ${unresolved}` +
    (failures.length ? `\n  parse failures: ${failures.length}\n    ` + failures.slice(0, 5).join("\n    ") : ""),
);
