import { describe, expect, it, vi } from "vitest";
import { requestMobileToken, verifyToken } from "../src/auth.js";

describe("Moodle mobile token setup", () => {
  it("uses POST and saves the token field, never privatetoken", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://moodle.polymtl.ca/login/token.php");
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      expect(new URLSearchParams(init?.body as string).get("service")).toBe("moodle_mobile_app");
      expect(new URLSearchParams(init?.body as string).get("password")).toBe("P&WD");
      return new Response(JSON.stringify({ token: "THE_WS_TOKEN", privatetoken: "NOT_FOR_REST" }));
    });
    await expect(requestMobileToken("https://moodle.polymtl.ca", "student", "P&WD", fetcher)).resolves.toBe("THE_WS_TOKEN");
  });

  it("does not expose Moodle messages or transport errors containing a password", async () => {
    await expect(requestMobileToken("https://moodle.polymtl.ca", "student", "P&WD", async () =>
      new Response(JSON.stringify({ errorcode: "invalidlogin", error: "P&WD" }), { status: 403 }),
    )).rejects.not.toThrow("P&WD");
    await expect(requestMobileToken("https://moodle.polymtl.ca", "student", "P&WD", async () => {
      throw new Error("request password=P&WD failed");
    })).rejects.not.toThrow("P&WD");
  });

  it("checks token permissions without storing credentials", async () => {
    await expect(verifyToken("https://moodle.polymtl.ca", "MY_TOKEN", async (_url, init) => {
      expect(new URLSearchParams(init?.body as string).get("wstoken")).toBe("MY_TOKEN");
      return new Response(JSON.stringify({ userid: 42 }));
    })).resolves.toBeUndefined();
    await expect(verifyToken("https://moodle.polymtl.ca", "MY_TOKEN", async () =>
      new Response(JSON.stringify({ exception: "moodle_exception", message: "bad token" })),
    )).rejects.toThrow("ne peut pas accéder");
  });
});
