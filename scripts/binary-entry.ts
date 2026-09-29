// This entrypoint is compiled by Bun. The regular npm/Node entrypoint stays
// dependency-free and reads catalog/functions.json from the installed package.
import catalogFile from "../catalog/functions.json" with { type: "file" };
import { setEmbeddedCatalogPath } from "../src/catalog.js";

setEmbeddedCatalogPath(catalogFile);
await import("../src/index.js");
