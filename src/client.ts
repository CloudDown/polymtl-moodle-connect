import type { MoodleConfig } from "./config.js";

export class MoodleApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "MoodleApiError";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const SENSITIVE_KEYS = new Set(["wstoken", "token", "userprivateaccesskey", "privateaccesskey", "accesskey", "password", "secret"]);

/** Scrub both known fields and literal token occurrences in returned text. */
export function redact(value: unknown, token: string): unknown {
  if (typeof value === "string") return value.replaceAll(token, "[redacted]");
  if (Array.isArray(value)) return value.map((item) => redact(item, token));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEYS.has(key.toLowerCase()) ? "[redacted]" : redact(item, token),
  ]));
}

/** Moodle REST expects form fields such as courseids[0] and options[name]. */
export function appendMoodleParams(form: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendMoodleParams(form, `${key}[${index}]`, item));
  } else if (typeof value === "object") {
    for (const [child, item] of Object.entries(value)) appendMoodleParams(form, `${key}[${child}]`, item);
  } else {
    form.append(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
  }
}

export class MoodleClient {
  constructor(private readonly config: MoodleConfig, private readonly fetchImpl: FetchLike = fetch) {}

  async call<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new MoodleApiError("Invalid Moodle function name.", 0);
    const form = new URLSearchParams({
      wstoken: this.config.token,
      wsfunction: name,
      moodlewsrestformat: "json",
    });
    for (const [key, value] of Object.entries(args)) appendMoodleParams(form, key, value);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}/webservice/rest/server.php`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: form.toString(),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch {
      // Fetch implementations can include the entire request (and token) in
      // thrown messages. Never propagate the original error or cause.
      throw new MoodleApiError("Cannot contact Moodle. Check the URL, network and timeout.", 0);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new MoodleApiError(`Moodle returned a non-JSON response (HTTP ${response.status}).`, response.status);
    }
    if (data && typeof data === "object" && !Array.isArray(data) && "exception" in data) {
      const error = data as { message?: unknown; errorcode?: unknown };
      const message = typeof error.message === "string" ? error.message : "Moodle rejected the request.";
      throw new MoodleApiError(String(redact(message, this.config.token)), response.status,
        typeof error.errorcode === "string" ? error.errorcode : undefined);
    }
    if (!response.ok) throw new MoodleApiError(`Moodle returned HTTP ${response.status}.`, response.status);
    return redact(data, this.config.token) as T;
  }

  siteInfo(): Promise<unknown> {
    return this.call("core_webservice_get_site_info");
  }
}
