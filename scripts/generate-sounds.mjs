import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sampleRate = 44100;
const glass = [[1, 1], [2.76, 0.24], [4.1, 0.08]];
const wood = [[1, 1], [3, 0.18], [5, 0.04]];
const soft = [[1, 1], [2, 0.12]];
const bell = [[1, 1], [2.01, 0.3], [3.9, 0.1]];

export const sounds = [
  { id: 'chime-glass', duration: 1.4, partials: glass, decay: 5, notes: [[0, 1046.5, 0.85], [0.25, 783.99, 1]] },
  { id: 'chime-wood', duration: 1.1, partials: wood, decay: 9, notes: [[0, 659.25, 0.65], [0.26, 523.25, 0.75]] },
  { id: 'bell-rise', duration: 1.6, partials: bell, decay: 5, notes: [[0, 523.25, 0.8], [0.3, 659.25, 0.8], [0.6, 783.99, 0.9]] },
  { id: 'beep-soft', duration: 1.3, partials: soft, decay: 2, notes: [[0, 440, 0.32], [0.5, 554.37, 0.32]] },
  { id: 'tap', duration: 0.5, partials: wood, decay: 15, notes: [[0, 880, 0.3]] },
  { id: 'low-knock', duration: 0.6, partials: [[1, 1], [1.48, 0.25], [2.4, 0.08]], decay: 12, notes: [[0, 196, 0.4]] },
  { id: 'resolve', duration: 1.6, partials: soft, decay: 3, notes: [[0, 261.63, 1.5], [0.06, 329.63, 1.4], [0.12, 392, 1.35], [0.2, 523.25, 1.3]] },
  { id: 'done-blip', duration: 0.9, partials: soft, decay: 7, notes: [[0, 659.25, 0.35], [0.16, 987.77, 0.55]] }
];

export function renderSound(sound) {
  const samples = new Float64Array(Math.round(sound.duration * sampleRate));
  for (const [start, frequency, duration] of sound.notes) {
    const first = Math.round(start * sampleRate);
    const length = Math.round(duration * sampleRate);
    for (let offset = 0; offset < length && first + offset < samples.length; offset += 1) {
      const time = offset / sampleRate;
      const attack = Math.sin(Math.min(1, time / 0.012) * Math.PI / 2) ** 2;
      const release = Math.sin(Math.min(1, (length - 1 - offset) / (sampleRate * 0.08)) * Math.PI / 2) ** 2;
      for (const [ratio, amplitude] of sound.partials) {
        samples[first + offset] += amplitude * attack * release
          * Math.exp(-sound.decay * time * Math.sqrt(ratio))
          * Math.sin(2 * Math.PI * frequency * ratio * time);
      }
    }
  }
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak === 0) throw new Error(`Empty sound: ${sound.id}`);
  for (let index = 0; index < samples.length; index += 1) samples[index] *= 0.42 / peak;
  return samples;
}

export function encodeWav(samples) {
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index += 1) {
    wav.writeInt16LE(Math.round(samples[index] * 32767), 44 + index * 2);
  }
  return wav;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const directory = fileURLToPath(new URL('../public/sounds/', import.meta.url));
  mkdirSync(directory, { recursive: true });
  for (const sound of sounds) {
    writeFileSync(resolve(directory, `${sound.id}.wav`), encodeWav(renderSound(sound)));
    console.log(`${sound.id}.wav (${sound.duration}s)`);
  }
}