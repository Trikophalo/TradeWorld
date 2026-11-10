/**
 * Generates the 8-bit sound effects as small mono WAV files (8 kHz would be
 * too rough, so 22.05 kHz, 8 bit). Run with `pnpm tsx scripts/gen-sounds.ts`.
 * The sounds are synthesised here, so there is no licence to track.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RATE = 22_050;

interface Note {
  /** Frequency in Hz, 0 = silence. */
  freq: number;
  /** Seconds */
  dur: number;
  /** Slide to this frequency over the note. */
  to?: number;
  wave?: "square" | "triangle" | "noise";
}

function render(notes: Note[], volume = 0.5): Uint8Array {
  const samples: number[] = [];
  let noiseSeed = 1;
  for (const note of notes) {
    const count = Math.floor(note.dur * RATE);
    let phase = 0;
    for (let i = 0; i < count; i++) {
      const progress = i / count;
      const freq = note.to ? note.freq + (note.to - note.freq) * progress : note.freq;
      phase += freq / RATE;
      let value = 0;
      if (freq > 0) {
        if (note.wave === "triangle") value = 4 * Math.abs((phase % 1) - 0.5) - 1;
        else if (note.wave === "noise") {
          noiseSeed = (noiseSeed * 1103515245 + 12345) & 0x7fffffff;
          value = noiseSeed / 0x3fffffff - 1;
        } else value = phase % 1 < 0.5 ? 1 : -1;
      }
      // Short attack and a linear decay keep the clicks out.
      const envelope = Math.min(1, i / (0.004 * RATE)) * (1 - progress) ** 1.5;
      samples.push(value * envelope * volume);
    }
  }
  return Uint8Array.from(samples, (s) => Math.max(0, Math.min(255, Math.round(128 + s * 127))));
}

function wav(data: Uint8Array): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, Buffer.from(data)]);
}

const SOUNDS: Record<string, { notes: Note[]; volume?: number }> = {
  tap: { notes: [{ freq: 880, dur: 0.04 }], volume: 0.35 },
  success: {
    notes: [
      { freq: 659, dur: 0.07 },
      { freq: 988, dur: 0.14 },
    ],
  },
  coin: {
    notes: [
      { freq: 988, dur: 0.06 },
      { freq: 1319, dur: 0.22 },
    ],
  },
  error: {
    notes: [
      { freq: 220, dur: 0.09 },
      { freq: 0, dur: 0.03 },
      { freq: 165, dur: 0.16 },
    ],
    volume: 0.45,
  },
  warning: {
    notes: [
      { freq: 440, dur: 0.1 },
      { freq: 0, dur: 0.05 },
      { freq: 440, dur: 0.1 },
      { freq: 0, dur: 0.05 },
      { freq: 330, dur: 0.2 },
    ],
  },
  "level-up": {
    notes: [
      { freq: 523, dur: 0.08 },
      { freq: 659, dur: 0.08 },
      { freq: 784, dur: 0.08 },
      { freq: 1047, dur: 0.1 },
      { freq: 784, dur: 0.06 },
      { freq: 1047, dur: 0.3 },
    ],
  },
};

const outDir = join(process.cwd(), "public", "sounds");
mkdirSync(outDir, { recursive: true });
for (const [name, { notes, volume }] of Object.entries(SOUNDS)) {
  const file = wav(render(notes, volume));
  writeFileSync(join(outDir, `${name}.wav`), file);
  console.log(`${name}.wav  ${file.length} bytes`);
}
