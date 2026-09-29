import type { FetchLike } from "./client.js";
import { MoodleClient } from "./client.js";
import { normalizeBaseUrl } from "./config.js";

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

/**
 * Moodle's built-in mobile service token endpoint. Passwords travel in a TLS
 * protected POST body, never in a URL, output, saved settings or an error cause.
 */
export async function requestMobileToken(
  site: string,
  username: string,
  password: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const baseUrl = normalizeBaseUrl(site);
  if (!username.trim() || !password) throw new TokenError("Entrez votre identifiant et votre mot de passe Moodle.");
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/login/token.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ username: username.trim(), password, service: "moodle_mobile_app" }).toString(),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    // A thrown fetch error can contain the full request, including credentials.
    throw new TokenError("Connexion à Moodle impossible. Vérifiez l'adresse du site et votre connexion Internet.");
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new TokenError("Moodle n'a pas renvoyé de token. Le service mobile est peut-être indisponible.");
  }
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const data = result as { token?: unknown; privatetoken?: unknown; errorcode?: unknown };
    if (response.ok && typeof data.token === "string" && data.token.trim()) return data.token.trim();
    if (data.errorcode === "invalidlogin") {
      throw new TokenError("Moodle refuse la connexion. Vérifiez vos identifiants; avec SSO ou double authentification, demandez un token au soutien Moodle de votre école.");
    }
  }
  throw new TokenError("Moodle n'a pas fourni de token mobile. Vérifiez l'accès au service mobile avec votre école, ou choisissez l'option token existant.");
}

/** Validate the token against the same read-only call the MCP server will use. */
export async function verifyToken(site: string, token: string, fetchImpl?: FetchLike): Promise<void> {
  const client = new MoodleClient({ baseUrl: normalizeBaseUrl(site), token, timeoutMs: 30_000, allowWrite: false }, fetchImpl);
  try {
    const info = await client.siteInfo() as { userid?: number };
    if (!info || typeof info.userid !== "number") throw new TokenError("Ce token n'identifie aucun compte Moodle.");
  } catch {
    throw new TokenError("Le token ne peut pas accéder à ce site Moodle. Vérifiez ses permissions et l'adresse du site.");
  }
}
