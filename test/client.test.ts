import { describe, expect, it, vi } from "vitest";
import { appendMoodleParams, MoodleClient } from "../src/client.js";
import { loadConfig } from "../src/config.js";

const config = { baseUrl: "https://school.example/moodle", token: "private-token", timeoutMs: 1000, allowWrite: false };

describe("Moodle REST encoding", () => {
  it("serializes arrays and nested objects as Moodle bracket fields", () => {
    const form = new URLSearchParams();
    appendMoodleParams(form, "courseids", [12, 34]);
    appendMoodleParams(form, "options", { visible: true, flags: [false] });
    expect([...form]).toEqual([
      ["courseids[0]", "12"], ["courseids[1]", "34"],
      ["options[visible]", "1"], ["options[flags][0]", "0"],
    ]);
  });

  it("POSTs credentials outside the URL and redacts private keys and echoed tokens", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://school.example/moodle/webservice/rest/server.php");
      expect(init?.method).toBe("POST");
      const body = new URLSearchParams(init?.body as string);
      expect(body.get("wstoken")).toBe("private-token");
      expect(body.get("courseids[0]")).toBe("12");
      return new Response(JSON.stringify({ userprivateaccesskey: "other-secret", url: "private-token" }));
    });
    const response = await new MoodleClient(config, fetcher).call("mod_quiz_get_quizzes_by_courses", { courseids: [12] });
    expect(response).toEqual({ userprivateaccesskey: "[redacted]", url: "[redacted]" });
  });

  it("does not leak the token through Moodle or transport errors", async () => {
    const moodle = new MoodleClient(config, async () => new Response(JSON.stringify({ exception: "moodle_exception", message: "bad private-token" })));
    await expect(moodle.call("foo")).rejects.toThrow("bad [redacted]");
    const transport = new MoodleClient(config, async () => { throw new Error("request private-token failed"); });
    await expect(transport.call("foo")).rejects.toThrow("Cannot contact Moodle");
  });
});

describe("student configuration", () => {
  it("uses site and token from environment, without requiring per-device installation", () => {
    expect(loadConfig({ MOODLE_URL: "school.example/moodle/", MOODLE_TOKEN: "abc" })).toMatchObject({
      baseUrl: "https://school.example/moodle", token: "abc", allowWrite: false,
    });
  });
});
