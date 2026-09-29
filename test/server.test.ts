import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MoodleClient } from "../src/client.js";
import { createServer } from "../src/server.js";
import { FunctionIndex, loadCatalog, toJsonSchema } from "../src/catalog.js";

const config = { baseUrl: "https://school.example", token: "private-token", timeoutMs: 1000, allowWrite: false };

describe("bundled Moodle catalog", () => {
  it("has a usable schema for legacy quiz functions", () => {
    const index = FunctionIndex.fromCatalog(loadCatalog());
    expect(index.size).toBeGreaterThan(700);
    const fn = index.get("mod_quiz_get_quizzes_by_courses")!;
    expect(fn.parameters.courseids?.optional).toBe(true);
    expect(toJsonSchema(fn).required).toEqual([]);
    expect((toJsonSchema(fn).properties as Record<string, unknown>).courseids).toMatchObject({ type: "array", items: { type: "integer" } });
    const grades = index.get("gradereport_user_get_grade_items")!;
    expect(toJsonSchema(grades).required).toContain("courseid");
  });
});

describe("MCP connection", () => {
  const clients: Array<{ client: Client; server: ReturnType<typeof createServer> }> = [];
  afterEach(async () => {
    for (const { client, server } of clients.splice(0)) {
      await client.close();
      await server.close();
    }
  });

  it("lists tools, filters discovery by token and blocks write functions by default", async () => {
    const fetcher = async (_url: string, init?: RequestInit) => {
      const form = new URLSearchParams(init?.body as string);
      if (form.get("wsfunction") === "core_webservice_get_site_info") {
        return new Response(JSON.stringify({ userid: 15, sitename: "Campus", functions: [
          { name: "core_enrol_get_users_courses" }, { name: "core_course_create_courses" },
        ] }));
      }
      return new Response(JSON.stringify([{ id: 42, fullname: "Calcul" }]));
    };
    const server = createServer(config, new MoodleClient(config, fetcher));
    const client = new Client({ name: "test", version: "1.0" });
    clients.push({ client, server });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("moodle_my_courses");
    const status = await client.callTool({ name: "moodle_status" });
    expect(JSON.stringify(status)).toContain("Campus");
    const discover = await client.callTool({ name: "ws_discover", arguments: { query: "course", limit: 10 } });
    expect(JSON.stringify(discover)).toContain("core_enrol_get_users_courses");
    expect(JSON.stringify(discover)).not.toContain("mod_quiz_get_quizzes_by_courses");
    const courses = await client.callTool({ name: "moodle_my_courses" });
    expect(JSON.stringify(courses)).toContain("Calcul");
    const write = await client.callTool({ name: "ws_call", arguments: { name: "core_course_create_courses" } });
    expect(write.isError).toBe(true);
    expect(JSON.stringify(write)).toContain("MOODLE_ALLOW_WRITE");
  });
});
