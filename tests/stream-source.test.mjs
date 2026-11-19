import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { setImmediate as tick } from 'node:timers/promises';

const source = (await readFile(new URL('../dist/stream-source.js', import.meta.url), 'utf8'))
  .replace('export function', 'function')
  .replaceAll('import.meta.url', JSON.stringify(new URL('../dist/stream-source.js', import.meta.url).href));

function harness({ waitForWorklet = Promise.resolve() } = {}) {
  const workers = [], captures = [], sounds = [], timers = new Map();
  const heard = [], failures = [];
  let sequence = 0;
  class Node {
    constructor() { this.outputs = []; this.gain = { value: 1 }; }
    connect(node) { this.outputs.push(node); return node; }
    disconnect() { this.disconnected = true; }
  }
  const context = {
    currentTime: 20, destination: {},
    audioWorklet: { addModule: () => waitForWorklet },
    createGain: () => new Node(),
    createBuffer(channels, length, rate) {
      return { channels, length, rate, duration: length / rate, copyToChannel() {} };
    },
    createBufferSource() {
      const node = new Node();
      node.start = time => { node.startTime = time; };
      node.stop = () => { node.stopped = true; };
      sounds.push(node);
      return node;
    },
  };
  class Worker {
    constructor() { this.messages = []; workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    emit(data) { this.onmessage({ data }); }
  }
  class AudioWorkletNode extends Node {
    constructor() { super(); this.port = {}; captures.push(this); }
  }
  const scope = { URL, Error, Worker, AudioWorkletNode,
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.createContext(scope);
  vm.runInContext(source + '\nglobalThis.createSource = createDecodedStream;', scope);
  const stream = scope.createSource(context, 'https://radio.example/stream', {
    onSamples: samples => heard.push(samples), onError: error => failures.push(error),
  });
  const pcm = () => workers[0].emit({ type: 'pcm', sampleRate: 44100, channelData: [new Float32Array(44100).fill(0.2)] });
  return { stream, context, workers, captures, sounds, timers, heard, failures, pcm };
}

test('decoded live audio reaches capture at playback speed with the speakers muted', async () => {
  const app = harness();
  await tick();
  app.pcm();
  await app.stream.ready;
  assert.equal(app.stream.gain.gain.value, 0);
  assert.ok(app.sounds[0].outputs.includes(app.captures[0]));
  assert.ok(app.sounds[0].outputs.includes(app.stream.gain));
  assert.equal(app.heard.length, 0, 'network arrival must not be mistaken for playback time');
  const rendered = new Float32Array([0.2, 0.3]);
  app.captures[0].port.onmessage({ data: rendered });
  assert.equal(app.heard[0], rendered);
  app.pcm();
  assert.equal(app.sounds[1].startTime, app.sounds[0].startTime + 1);
  app.stream.stop();
});

test('stop aborts an unfinished connection and prevents late decoder audio from playing', async () => {
  let open;
  const app = harness({ waitForWorklet: new Promise(resolve => { open = resolve; }) });
  const cancelled = assert.rejects(app.stream.ready, /cancelled/);
  app.stream.stop();
  open();
  await cancelled;
  await tick();
  assert.equal(app.workers.length, 0);
  assert.equal(app.timers.size, 0);
  assert.equal(app.stream.gain.disconnected, true);
});

test('stopping a connected stream releases queued playback, capture and network worker', async () => {
  const app = harness();
  await tick();
  app.pcm();
  await app.stream.ready;
  app.stream.stop();
  app.pcm();
  assert.equal(app.sounds.length, 1);
  assert.equal(app.sounds[0].stopped, true);
  assert.equal(app.workers[0].terminated, true);
  assert.equal(app.captures[0].port.onmessage, null);
  assert.equal(app.timers.size, 0);
  assert.equal(app.failures.length, 0);
});

test('connection errors remain visible and an interrupted live stream notifies the app once', async () => {
  const first = harness();
  const rejected = assert.rejects(first.stream.ready, /offline/);
  await tick();
  first.workers[0].emit({ type: 'error', message: 'offline' });
  await rejected;
  assert.equal(first.workers[0].terminated, true);
  const live = harness();
  await tick();
  live.pcm();
  await live.stream.ready;
  live.workers[0].emit({ type: 'error', message: 'disconnected' });
  live.workers[0].emit({ type: 'error', message: 'late' });
  assert.equal(live.failures.length, 1);
  assert.match(live.failures[0].message, /disconnected/);
});
