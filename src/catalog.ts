import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ParamType = "string" | "integer" | "number" | "boolean" | "array" | "object";

export interface ParamSchema {
  type: ParamType;
  raw?: string;
  description?: string;
  optional?: boolean;
  nullable?: boolean;
  items?: ParamSchema | Record<string, ParamSchema>;
  properties?: Record<string, ParamSchema>;
  note?: string;
}

export interface MoodleFunction {
  name: string;
  type: "read" | "write";
  description: string;
  parameters: Record<string, ParamSchema>;
  returns: Record<string, ParamSchema> | null;
  capabilities?: string;
  services?: string[];
  /** Moodle source file the schema was extracted from, e.g. `course/externallib.php`. */
  source?: string;
}

export interface Catalog {
  generator: string;
  moodle?: { version?: string; release?: string; branch?: string };
  functions: MoodleFunction[];
}

let embeddedCatalogPath: string | undefined;

/** Called only by the standalone binary entrypoint to use its embedded asset. */
export function setEmbeddedCatalogPath(path: string): void {
  embeddedCatalogPath = path;
}

/** Locates `catalog/functions.json` by walking up from this module. */
export function catalogPath(): string {
  if (embeddedCatalogPath) return embeddedCatalogPath;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 5; depth++) {
    const candidate = resolve(dir, "catalog/functions.json");
    try {
      readFileSync(candidate, "utf8");
      return candidate;
    } catch {
      /* keep walking up */
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("catalog/functions.json is missing from the installed package");
}

export function loadCatalog(path: string = catalogPath()): Catalog {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Catalog;
  if (!Array.isArray(parsed.functions) || parsed.functions.length === 0) {
    throw new Error(`catalog at ${path} contains no functions`);
  }
  return parsed;
}

export class FunctionIndex {
  private readonly byName: Map<string, MoodleFunction>;

  constructor(functions: readonly MoodleFunction[]) {
    this.byName = new Map(functions.map((fn) => [fn.name, fn]));
  }

  static fromCatalog(catalog: Catalog): FunctionIndex {
    return new FunctionIndex(catalog.functions);
  }

  get size(): number {
    return this.byName.size;
  }

  get(name: string): MoodleFunction | undefined {
    return this.byName.get(name);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  names(): string[] {
    return [...this.byName.keys()];
  }

  /**
   * Ranked substring search over the function name, description and summary.
   * An exact or prefix name match always outranks a description hit.
   */
  search(query: string, limit = 25): MoodleFunction[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [...this.byName.values()].slice(0, limit);

    const terms = needle.split(/\s+/).filter(Boolean);
    const scored: Array<{ fn: MoodleFunction; score: number }> = [];

    for (const fn of this.byName.values()) {
      const name = fn.name.toLowerCase();
      const haystack = `${fn.name} ${fn.description}`.toLowerCase();
      let score = 0;
      let matchedTerms = 0;
      for (const term of terms) {
        if (name === term) score += 100;
        else if (name.startsWith(term)) score += 50;
        else if (name.includes(term)) score += 25;
        else if (fn.description.toLowerCase().includes(term)) score += 10;
        else if (haystack.includes(term)) score += 3;
        else continue;
        matchedTerms++;
      }
      // Every term must appear somewhere, so multi-word queries do not drift.
      if (matchedTerms === terms.length && score > 0) scored.push({ fn, score });
    }

    scored.sort((a, b) => b.score - a.score || a.fn.name.localeCompare(b.fn.name));
    return scored.slice(0, limit).map((entry) => entry.fn);
  }

  byCapability(capability: string): MoodleFunction[] {
    return [...this.byName.values()].filter((fn) => fn.capabilities?.split(",").some((c) => c.trim() === capability));
  }
}

/**
 * Converts a catalog entry into the JSON Schema exposed to the model. Moodle's
 * `VALUE_OPTIONAL`/`VALUE_DEFAULT` flags become non-required properties.
 */
export function toJsonSchema(fn: MoodleFunction): Record<string, unknown> {
  return {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(fn.parameters).map(([name, schema]) => [name, describe(schema)]),
    ),
    required: Object.entries(fn.parameters)
      .filter(([, schema]) => !schema.optional)
      .map(([name]) => name),
    additionalProperties: true,
  };
}

function describe(schema: ParamSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: schema.type };
  if (schema.description) out.description = schema.description;
  if (schema.nullable) out.type = [schema.type, "null"];
  if (schema.type === "array") {
    const items = schema.items;
    out.items = !items ? {} : "type" in items ? describe(items as ParamSchema) : {
      type: "object",
      properties: Object.fromEntries(Object.entries(items).map(([key, item]) => [key, describe(item)])),
      required: Object.entries(items).filter(([, item]) => !item.optional).map(([key]) => key),
    };
  }
  if (schema.type === "object" && schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, item]) => [key, describe(item)]));
    out.required = Object.entries(schema.properties).filter(([, item]) => !item.optional).map(([key]) => key);
  }
  return out;
}
