import assert from "node:assert/strict";
import test from "node:test";
import toneMidi from "@tonejs/midi";
import { parseMidi, writeMidi } from "midi-file";

const { Midi } = toneMidi;
const keys = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];

test("repairs key signature bytes so exported MIDI retains key and scale", () => {
  const midi = new Midi();
  midi.header.keySignatures.push({ ticks: 0, key: "D", scale: "minor" });
  midi.addTrack().addNote({ midi: 62, ticks: 0, durationTicks: 480 });

  const parsed = parseMidi(midi.toArray());
  parsed.tracks.flat().forEach((event) => {
    if (event.type === "keySignature") {
      event.key = keys.indexOf("D") - 7;
      event.scale = 1;
    }
  });

  const roundTrip = new Midi(Uint8Array.from(writeMidi(parsed)));
  assert.deepEqual(roundTrip.header.keySignatures, [{ key: "D", scale: "minor", ticks: 0 }]);
});
