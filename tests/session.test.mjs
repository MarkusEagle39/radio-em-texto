import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as audioUtils from '../dist/audio-utils.js';

// Exercise the application itself, replacing only browser boundaries. No radio
// connection or model download is needed to reproduce capture/session races.
const appUrl = new URL('../dist/app.js', import.meta.url);
const appSource = (await readFile(appUrl, 'utf8'))
  .replace(/^import[^\n]+\n/, '')
  .replaceAll('import.meta.url', JSON.stringify(appUrl.href));

class Element {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.textContent = '';
    this.scrollCalls = [];
    this.style = { setProperty() {} };
    const classes = new Set();
    this.classList = {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      toggle(name, force = !classes.has(name)) {
        if (force) classes.add(name); else classes.delete(name);
        return force;
      },
    };
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  addEventListener() {}
  focus() { this.focused = true; }
  append(...children) {
    for (const child of children) { child.parent = this; this.children.push(child); }
  }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  get firstElementChild() { return this.children[0]; }
  get scrollHeight() { return this.children.length * 100; }
  scrollTo(value) { this.scrollCalls.push(value); }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
  }
}

async function runningApp() {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: () => new Element(),
    querySelectorAll: () => [],
    addEventListener() {},
    body: new Element(),
    documentElement: new Element(),
    fullscreenEnabled: true,
  };
  const workers = [];
  class Worker {
    constructor() { this.messages = []; workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    emit(data) { this.onmessage({ data }); }
  }
  const scope = {
    ...audioUtils, document, Worker, URL, Date, console: { error() {} },
    window: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
  };
  vm.createContext(scope);
  vm.runInContext(appSource + '\nglobalThis.app = { state, ensureWorker, stop, clearCaptions, collectSamples, setFollowing, setReadingMode, setReadingHistory };', scope);
  const app = scope.app;
  const initialized = app.ensureWorker();
  const worker = workers[0];
  worker.emit({ type: 'ready' });
  await initialized;
  app.state.running = true;
  app.state.phase = 'live';
  app.state.model = 'small'; // Legacy session regressions exercise the 10-second profile.
  const result = (text, audioTime, session = app.state.session) => worker.emit({
    type: 'result', text, audioTime, session, capturedAt: Date.now() - 10000,
  });
  const transcriptions = () => worker.messages.filter(message => message.type === 'transcribe');
  return { ...app, worker, elements, result, transcriptions };
}

function startAnotherSession(app) {
  app.stop({ keepStatus: true });
  app.clearCaptions();
  app.state.running = true;
  app.state.phase = 'live';
}

const sound = length => new Float32Array(length).fill(0.1);

test('an old-session result releases the new session queue without publishing old speech', async () => {
  const app = await runningApp();
  app.collectSamples(sound(160000));
  const oldSession = app.state.session;
  startAnotherSession(app);
  app.collectSamples(sound(160000));
  assert.equal(app.state.queue.length, 1);
  app.result('Texto da sessão que já terminou.', 9, oldSession);
  assert.equal(app.state.captions.length, 0);
  assert.equal(app.elements.get('transcript-list').children.length, 0);
  assert.equal(app.state.lastText, '');
  assert.equal(app.state.queue.length, 0);
  assert.equal(app.transcriptions().length, 2);
  assert.equal(app.transcriptions()[1].session, app.state.session);
  assert.equal(app.state.workerBusy, true);
});

test('an old-session recognition error also releases current work without stopping the new session', async () => {
  const app = await runningApp();
  app.collectSamples(sound(160000));
  const oldSession = app.state.session;
  startAnotherSession(app);
  app.collectSamples(sound(160000));
  app.worker.emit({ type: 'error', session: oldSession, message: 'Previous task failed' });
  assert.equal(app.state.running, true);
  assert.equal(app.state.phase, 'live');
  assert.equal(app.state.queue.length, 0);
  assert.equal(app.transcriptions().length, 2);
  assert.equal(app.transcriptions()[1].session, app.state.session);
});

test('a genuinely repeated phrase after a skipped silent window remains visible', async () => {
  const app = await runningApp();
  const firstWindow = new Float32Array(160000);
  firstWindow.fill(0.1, 0, 32000);
  app.collectSamples(firstWindow);
  app.result('Muito obrigado!', 9);
  app.collectSamples(new Float32Array(144000));
  assert.equal(app.transcriptions().length, 1, 'silent window should not invoke recognition');
  app.collectSamples(sound(144000));
  assert.equal(app.transcriptions()[1].audioTime, 27);
  app.result('Muito obrigado.', 27);
  assert.deepEqual(Array.from(app.state.captions, caption => caption.text), ['Muito obrigado!', 'Muito obrigado.']);
});

test('consecutive overlapping capture windows do not duplicate the same spoken words', async () => {
  const app = await runningApp();
  app.collectSamples(sound(160000));
  app.result('Notícias de Campinas, São Paulo.', 9);
  app.collectSamples(sound(144000));
  assert.equal(app.transcriptions()[1].audioTime, 18);
  app.result('Campinas São Paulo: a previsão é de chuva.', 18);
  assert.deepEqual(Array.from(app.state.captions, caption => caption.text), [
    'Notícias de Campinas, São Paulo.', 'a previsão é de chuva.',
  ]);
});

test('dropping queued audio preserves repetition across the resulting gap even when an older inference finishes later', async () => {
  const app = await runningApp();
  app.collectSamples(sound(160000));
  app.collectSamples(sound(144000));
  app.collectSamples(sound(144000));
  app.collectSamples(sound(144000));
  assert.equal(app.state.queue.length, 1);
  assert.match(app.state.captions[0].text, /Trecho não transcrito/);
  app.result('Muito obrigado!', 9);
  assert.equal(app.transcriptions()[1].audioTime, 36);
  app.result('Muito obrigado.', 36);
  assert.equal(app.state.captions.at(-1).text, 'Muito obrigado.');
});

test('pausing reading stops automatic scrolling while capture and captions continue', async () => {
  const app = await runningApp();
  app.setFollowing(false);
  const transcript = app.elements.get('transcript');
  const scrollCount = transcript.scrollCalls.length;
  app.collectSamples(sound(160000));
  app.result('Nova informação para ler no seu ritmo.', 9);
  assert.equal(app.state.running, true);
  assert.equal(app.state.following, false);
  assert.equal(app.state.captions.length, 1);
  assert.equal(transcript.scrollCalls.length, scrollCount);
  app.setFollowing(true);
  assert.equal(transcript.scrollCalls.length, scrollCount + 1);
});

test('balanced mode submits the first audio at six seconds and subsequent windows every five seconds', async () => {
  const app = await runningApp();
  app.state.model = 'base';
  app.collectSamples(sound(95999));
  assert.equal(app.transcriptions().length, 0);
  app.collectSamples(sound(1));
  assert.equal(app.transcriptions().length, 1);
  assert.equal(app.transcriptions()[0].audio.length, 96000);
  assert.equal(app.transcriptions()[0].stepSeconds, 5);
  app.worker.emit({ type: 'result', text: 'Notícias de Campinas.', session: app.state.session, audioTime: 5, stepSeconds: 5, capturedAt: Date.now() });
  app.collectSamples(sound(80000));
  assert.equal(app.transcriptions().length, 2);
  assert.equal(app.transcriptions()[1].audioTime, 10);
});

test('draft words are visible without entering saved history; final result replaces the draft and stop clears it', async () => {
  const app = await runningApp();
  app.worker.emit({ type: 'partial', text: 'Notícias de', session: app.state.session, audioTime: 9, stepSeconds: 9 });
  assert.equal(app.state.captions.length, 0);
  assert.match(app.elements.get('draft-text').textContent, /Notícias de/);
  app.result('Notícias de Campinas.', 9);
  assert.equal(app.elements.get('draft-text').hidden, true);
  assert.equal(app.state.captions[0].text, 'Notícias de Campinas.');
  app.worker.emit({ type: 'partial', text: 'Outra frase', session: app.state.session - 1 });
  assert.equal(app.elements.get('draft-text').hidden, true);
  app.stop();
  assert.equal(app.elements.get('draft-text').textContent, '');
});

test('reading mode preserves the session and restores the previous scrolling preference on exit', async () => {
  const app = await runningApp();
  app.setFollowing(false);
  const session = app.state.session;
  app.setReadingMode(true);
  assert.equal(app.state.reading, true);
  assert.equal(app.state.following, true);
  assert.equal(app.elements.get('reading-bar').hidden, false);
  app.result('Primeira legenda.', 9);
  app.setReadingMode(false);
  assert.equal(app.state.running, true);
  assert.equal(app.state.session, session);
  assert.equal(app.state.following, false);
  assert.equal(app.state.captions[0].text, 'Primeira legenda.');
  assert.equal(app.elements.get('reading-bar').hidden, true);
});

test('reading history pauses scrolling while new captions continue to accumulate', async () => {
  const app = await runningApp();
  app.setReadingMode(true);
  app.result('Notícia anterior.', 9);
  app.setReadingHistory(true);
  assert.equal(app.state.following, false);
  const scrolls = app.elements.get('transcript').scrollCalls.length;
  app.result('Nova notícia.', 18);
  assert.equal(app.state.captions.length, 2);
  assert.equal(app.elements.get('transcript').scrollCalls.length, scrolls);
  assert.equal(app.state.running, true);
  app.setReadingHistory(false);
  assert.equal(app.state.following, true);
  assert.equal(app.elements.get('reading-history-btn').getAttribute('aria-pressed'), 'false');
});
