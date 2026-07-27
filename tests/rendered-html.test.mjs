import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships the focused MIDI track player", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

  assert.match(layout, /MIDI Track Player/);
  assert.match(page, /parseMidi/);
  assert.match(page, /arrayBuffer/);
  assert.match(page, /muted/);
  assert.match(page, /solo/);
  assert.match(page, /播放/);
  assert.match(page, /暂停/);
  assert.match(css, /\.track-row/);
  assert.match(css, /\.main-play/);
  assert.doesNotMatch(page, /splitRegion|mergeRegions|addTempoEvent|addKeyEvent/);
});
