import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { sounds, renderSound, encodeWav } from './generate-sounds.mjs';

test('eight original reminder sounds produce quiet-ended, unclipped mono PCM WAV assets', () => {
  assert.equal(sounds.length, 8);
  assert.equal(new Set(sounds.map(sound => sound.id)).size, 8);
  for (const sound of sounds) {
    const samples = renderSound(sound);
    assert.ok(samples.length >= 44100 * 0.4 && samples.length <= 44100 * 1.6, sound.id);
    assert.equal(samples[0], 0, sound.id);
    assert.equal(samples.at(-1), 0, sound.id);
    let peak = 0;
    let energy = 0;
    let maxStep = 0;
    for (let index = 0; index < samples.length; index += 1) {
      assert.ok(Number.isFinite(samples[index]), sound.id);
      peak = Math.max(peak, Math.abs(samples[index]));
      energy += samples[index] ** 2;
      if (index > 0) maxStep = Math.max(maxStep, Math.abs(samples[index] - samples[index - 1]));
    }
    assert.ok(peak >= 0.2 && peak <= 0.5, `${sound.id} peak ${peak}`);
    assert.ok(Math.sqrt(energy / samples.length) > 0.025, `${sound.id} is audible`);
    assert.ok(maxStep < 0.15, `${sound.id} sample step ${maxStep}`);
    const wav = encodeWav(samples);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt32LE(4), wav.length - 8);
    assert.equal(wav.readUInt16LE(20), 1);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 44100);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.readUInt32LE(40), samples.length * 2);
    assert.deepEqual(readFileSync(new URL(`../public/sounds/${sound.id}.wav`, import.meta.url)), wav, sound.id);
  }
});