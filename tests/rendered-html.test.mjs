import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships the Harmonic Studio editor", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

  assert.match(layout, /Harmonic Studio/);
  assert.match(page, /splitRegion/);
  assert.match(page, /mergeRegions/);
  assert.match(page, /addTempoEvent/);
  assert.match(page, /addKeyEvent/);
  assert.match(page, /PIANO ROLL/);
  assert.match(page, /degreeFor/);
  assert.match(css, /\.midi-note/);
  assert.match(css, /\.region/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
});
