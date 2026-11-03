import { describe, it } from "node:test";
import assert from "node:assert/strict";
import config from "../../vite.config.js";

const strip = config.plugins.find((p) => p && p.name === "animalid-strip-prod-logs");
const run = (code, id = "E:/Hackathon/src/x.js") => strip.transform(code, id);

describe("stripProdLogs vite plugin", () => {
  it("is registered as a build-only pre transform", () => {
    assert.ok(strip, "plugin must exist in vite.config.js");
    assert.equal(strip.apply, "build");
    assert.equal(strip.enforce, "pre");
  });

  it("removes log/debug/info statements and debugger, keeps error/warn", async () => {
    const out = await run(
      'console.log("a");\nconsole.debug("b");\nconsole.info("c");\nconsole.error("d");\nconsole.warn("e");\ndebugger;',
    );
    assert.ok(out, "expected a transform result");
    assert.doesNotMatch(out.code, /console\.(log|debug|info)/);
    assert.doesNotMatch(out.code, /\bdebugger\b/);
    assert.match(out.code, /console\.error\("d"\)/);
    assert.match(out.code, /console\.warn\("e"\)/);
  });

  it("strips nested statements but keeps valued references", async () => {
    const out = await run(
      "function f(){\n  if (x) { console.log(\"nested\"); }\n  const g = console.log;\n  const v = (a(), console.log(\"seq\"));\n  return [g, v];\n}",
    );
    assert.ok(out);
    assert.doesNotMatch(out.code, /nested/);
    assert.match(out.code, /const g = console\.log;/);
    assert.match(out.code, /console\.log\("seq"\)/);
  });

  it("parses JSX modules", async () => {
    const out = await run(
      "export default function A(){\n  console.log(\"gone\");\n  return <b>hi</b>;\n}",
      "E:/Hackathon/src/A.jsx",
    );
    assert.ok(out);
    assert.doesNotMatch(out.code, /gone/);
    assert.match(out.code, /<b>hi<\/b>/);
  });

  it("passes through node_modules, non-JS, and unparseable code", async () => {
    assert.equal(await run('console.log("x");', "E:/Hackathon/node_modules/pkg/y.js"), null);
    assert.equal(await run("body { color: red; }", "E:/Hackathon/src/a.css"), null);
    assert.equal(await run("console.log("), null);
    assert.equal(await run("const a = 1;"), null);
  });
});
