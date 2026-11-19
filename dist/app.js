import { STATIONS, joinSamples, resample, rms, removeOverlap, isRepetitiveCaption, elapsedTime } from './audio-utils.js';

const $ = id => document.getElementById(id);
const state = {
  station: 'cbn', model: 'base', session: 0, running: false, phase: 'idle', demo: false,
  captions: [], following: true, sound: false, size: 26,
  reading: false, readingHistory: false, previousFollowing: true,
  worker: null, workerReady: false, workerBusy: false, init: null,
  audio: null, context: null, capture: null, gain: null, streamSource: null,
  samples: [], sampleCount: 0, audioTime: 0, queue: [], lastDelay: null,
  startedAt: 0, clock: null, demoTimer: null, lastText: '', lastAudioTime: null,
  progressFiles: new Map(), lastLevel: Date.now(), waitingTimer: null,
};
const SAMPLE_RATE = 16000;
function captureSeconds() { return state.model === 'small' ? 10 : 6; }
const OVERLAP = 16000;
const MAX_CAPTIONS = 180;

function status(text, kind = 'idle') {
  $('status-text').textContent = text;
  $('status-dot').dataset.state = kind;
}

function refreshControls() {
  const active = state.phase !== 'idle';
  $('start-btn').hidden = active;
  $('start-btn').disabled = !STATIONS[state.station].stream;
  $('start-btn').textContent = STATIONS[state.station].stream ? 'Iniciar legendas' : 'Integração em breve';
  $('stop-btn').hidden = !active;
  $('demo-btn').disabled = active;
  if ($('model-select')) $('model-select').disabled = active;
  $('sound-btn').disabled = !state.running || state.demo;
  $('sound-btn').setAttribute('aria-pressed', String(state.sound));
  $('sound-btn').textContent = state.sound ? 'Som ligado' : 'Som desligado';
  $('clear-btn').disabled = state.captions.length === 0;
  $('download-btn').disabled = state.captions.length === 0;
  $('caption-count').textContent = `${state.captions.length} ${state.captions.length === 1 ? 'trecho' : 'trechos'}`;
}

function showError(message) {
  $('error-message').textContent = message;
  $('error-panel').hidden = false;
  status('Não foi possível continuar', 'error');
}

function clearError() { $('error-panel').hidden = true; }

function followLatest(force = false) {
  if (state.following || force) {
    const panel = $('transcript');
    panel.scrollTo({ top: panel.scrollHeight, behavior: 'instant' });
  }
}

function setFollowing(value) {
  state.following = value;
  $('scroll-btn').setAttribute('aria-pressed', String(value));
  $('scroll-btn').textContent = value ? 'Pausar rolagem automática' : 'Ativar rolagem automática';
  $('jump-btn').hidden = value;
  if (value) followLatest(true);
}

function setReadingHistory(value) {
  state.readingHistory = Boolean(value);
  document.body.classList.toggle('reading-history', state.readingHistory);
  $('reading-history-btn').setAttribute('aria-pressed', String(state.readingHistory));
  $('current-caption-btn').setAttribute('aria-pressed', String(!state.readingHistory));
  if (state.reading) setFollowing(!state.readingHistory);
}

function setReadingMode(value) {
  const enabled = Boolean(value);
  if (state.reading === enabled) return;
  if (enabled) state.previousFollowing = state.following;
  state.reading = enabled;
  document.body.classList.toggle('reading-mode', enabled);
  $('reading-bar').hidden = !enabled;
  $('reading-tabs').hidden = !enabled;
  $('reading-btn').setAttribute('aria-pressed', String(enabled));
  if (enabled) {
    setReadingHistory(false);
    $('exit-reading-btn').focus();
  } else {
    setReadingHistory(false);
    setFollowing(state.previousFollowing);
    $('reading-btn').focus();
  }
}

function clearCaptions() {
  state.captions = [];
  state.lastText = '';
  state.lastAudioTime = null;
  $('transcript-list').replaceChildren();
  clearDraft();
  $('empty-state').hidden = false;
  refreshControls();
}

function appendCaption(text, capturedAt = Date.now()) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const time = new Date(capturedAt).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const caption = { text: trimmed, time, at: capturedAt, demo: state.demo };
  state.captions.push(caption);
  const entry = document.createElement('article');
  entry.className = 'caption';
  const stamp = document.createElement('span');
  stamp.className = 'caption-time';
  stamp.textContent = state.demo ? `${time} · Exemplo fictício` : time;
  const paragraph = document.createElement('p');
  paragraph.textContent = trimmed;
  entry.append(stamp, paragraph);
  $('transcript-list').append(entry);
  $('empty-state').hidden = true;
  if (state.captions.length > MAX_CAPTIONS) {
    state.captions.shift();
    $('transcript-list').firstElementChild?.remove();
  }
  followLatest();
  refreshControls();
}

function resetCapture() {
  state.samples = [];
  state.sampleCount = 0;
  state.audioTime = 0;
  state.lastDelay = null;
  state.queue = [];
}

function stop({ keepStatus = false } = {}) {
  const wasDemo = state.demo;
  const wasLoading = state.phase === 'loading';
  state.session++;
  state.running = false;
  state.phase = 'idle';
  state.demo = false;
  state.sound = false;
  clearInterval(state.clock);
  clearTimeout(state.demoTimer);
  clearInterval(state.waitingTimer);
  state.clock = null;
  state.waitingTimer = null;
  state.streamSource?.stop();
  state.streamSource = null;
  if (state.audio) {
    state.audio.onerror = null;
    state.audio.onwaiting = null;
    state.audio.onplaying = null;
    state.audio.pause();
    state.audio.removeAttribute('src');
    state.audio.load();
    state.audio = null;
  }
  if (state.capture) {
    state.capture.port.onmessage = null;
    state.capture.disconnect();
    state.capture = null;
  }
  state.context?.close().catch(() => {});
  state.context = null;
  state.gain = null;
  resetCapture();
  if (wasLoading && !state.workerReady) {
    state.init?.reject(new Error('cancelled'));
    state.worker?.terminate();
    state.worker = null;
    state.workerBusy = false;
    state.init = null;
  }
  $('progress-panel').hidden = true;
  $('pending-text').textContent = '';
  clearDraft();
  if (!keepStatus) status(wasDemo ? 'Demonstração encerrada' : 'Legendas interrompidas');
  refreshControls();
}

function fail(message) {
  stop({ keepStatus: true });
  showError(message);
}

function showProgress(progress) {
  if (state.phase !== 'loading') return;
  if (Number.isFinite(progress.total) && progress.total > 0) {
    state.progressFiles.set(progress.file, { loaded: progress.loaded || 0, total: progress.total });
  }
  const files = [...state.progressFiles.values()];
  const loaded = files.reduce((sum, file) => sum + file.loaded, 0);
  const total = files.reduce((sum, file) => sum + file.total, 0);
  if (total > 0) {
    $('model-progress').value = Math.min(95, loaded / total * 95);
    $('progress-detail').textContent = `Preparando reconhecimento · ${(loaded / 1048576).toFixed(1)} MB recebidos. Na primeira vez, o download é maior.`;
  } else {
    $('progress-detail').textContent = 'Carregando o reconhecimento de fala. A primeira preparação pode levar alguns minutos.';
  }
}

function ensureWorker() {
  if (state.workerReady) return Promise.resolve();
  if (state.init) return state.init.promise;
  const worker = new Worker(new URL('./speech-worker.js', import.meta.url), { type: 'module' });
  state.worker = worker;
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  state.init = { promise, resolve, reject };
  worker.onmessage = ({ data }) => {
    if (state.worker !== worker) return;
    if (data.type === 'progress') showProgress(data.progress);
    if (data.type === 'ready') {
      state.workerReady = true;
      state.init?.resolve();
      state.init = null;
    }
    if (data.type === 'partial' && state.running && !state.demo && data.session === state.session) {
      const contiguous = state.lastAudioTime !== null && Math.abs(data.audioTime - state.lastAudioTime - data.stepSeconds) < 0.01;
      const text = contiguous ? removeOverlap(state.lastText, data.text || '') : (data.text || '').trim();
      if (text && !isRepetitiveCaption(text)) {
        document.body.classList.add('has-current-caption');
        $('draft-text').hidden = false;
        $('draft-text').textContent = text;
        $('empty-state').hidden = true;
        followLatest();
      }
    }
    if (data.type === 'result') {
      state.workerBusy = false;
      if (state.running && data.session === state.session && !state.demo) {
        const contiguous = state.lastAudioTime !== null && Math.abs(data.audioTime - state.lastAudioTime - (data.stepSeconds ?? 9)) < 0.01;
        clearDraft();
        const repetitive = isRepetitiveCaption(data.text || '');
        const text = repetitive ? '[Trecho não reconhecido com clareza.]' : (contiguous ? removeOverlap(state.lastText, data.text || '') : (data.text || '').trim());
        state.lastText = repetitive ? '' : (data.text || '').trim();
        state.lastAudioTime = data.audioTime;
        appendCaption(text, data.capturedAt);
        const delay = Math.max(0, Math.round((Date.now() - data.capturedAt) / 1000));
        state.lastDelay = delay;
        $('pending-text').textContent = `Reconhecimento automático · atraso aproximado deste trecho: ${delay}s. Pode conter erros.`;
        status('Recebendo áudio e gerando legendas', 'live');
      }
      // A result from a stopped session must also release the current queue.
      drainQueue();
    }
    if (data.type === 'error') {
      console.error('Falha no reconhecimento:', data.message);
      state.workerBusy = false;
      if (state.init) {
        state.init.reject(new Error('model'));
        state.init = null;
      } else if (state.running && data.session === state.session) {
        fail('O reconhecimento de fala foi interrompido. Tente iniciar novamente ou escolha “Mais leve” em Reconhecimento.');
      }
      drainQueue();
    }
  };
  worker.onerror = event => {
    console.error('Falha no worker:', event.message);
    state.workerBusy = false;
    state.workerReady = false;
    worker.terminate();
    state.worker = null;
    if (state.init) {
      state.init.reject(new Error('worker'));
      state.init = null;
    } else if (state.running) {
      fail('O navegador não conseguiu executar o reconhecimento. Tente uma versão atual do Chrome, Edge, Firefox ou Safari.');
    }
  };
  worker.postMessage({ type: 'init', model: state.model });
  return promise;
}

function drainQueue() {
  if (!state.running || state.demo || !state.workerReady || state.workerBusy || !state.queue.length) return;
  const frame = state.queue.shift();
  state.workerBusy = true;
  state.worker.postMessage({ type: 'transcribe', ...frame, session: state.session, sentAt: Date.now() }, [frame.audio.buffer]);
  $('pending-text').textContent = state.lastDelay === null ? 'Transformando o áudio recebido em texto…' : `Último trecho: ${state.lastDelay}s de atraso aproximado · Reconhecendo o próximo… Pode conter erros.`;
}

function clearDraft() {
  document.body.classList.remove('has-current-caption');
  $('draft-text').textContent = '';
  $('draft-text').hidden = true;
}

function collectSamples(samples) {
  if (!state.running || state.demo) return;
  if (rms(samples) > 0.001) state.lastLevel = Date.now();
  state.samples.push(samples);
  state.sampleCount += samples.length;
  const seconds = captureSeconds();
  const windowSize = SAMPLE_RATE * seconds;
  const stepSeconds = seconds - 1;
  while (state.sampleCount >= windowSize) {
    const all = joinSamples(state.samples);
    const audio = all.slice(0, windowSize);
    const capturedAt = Date.now() - all.length / SAMPLE_RATE * 1000;
    const tail = all.slice(windowSize - OVERLAP);
    state.samples = [tail];
    state.sampleCount = tail.length;
    state.audioTime += stepSeconds;
    if (rms(audio) < 0.001) {
      $('pending-text').textContent = 'Áudio baixo ou silêncio. Aguardando o próximo trecho.';
      continue;
    }
    const frame = { audio, audioTime: state.audioTime, stepSeconds, capturedAt };
    if (state.queue.length >= 2) {
      state.queue = [];
      appendCaption('[Trecho não transcrito: o dispositivo não conseguiu acompanhar a transmissão.]');
      state.lastText = '';
    }
    state.queue.push(frame);
    drainQueue();
  }
}

async function connectRadio(session) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass || !window.AudioWorkletNode || !window.Worker) throw new Error('unsupported');
  const safari = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg\//.test(navigator.userAgent);
  const context = new AudioContextClass(safari ? undefined : { sampleRate: 16000 });
  state.context = context;
  await context.resume();
  if (state.session !== session) return;
  // Safari can play a live AAC stream while its MediaElementAudioSourceNode
  // supplies only zero samples. Decode the CORS-enabled stream directly there.
  if (safari) {
    const { createDecodedStream } = await import('./stream-source.js');
    if (state.session !== session) return;
    const stream = createDecodedStream(context, STATIONS[state.station].stream, {
      onSamples: samples => {
        if (state.session === session) collectSamples(resample(samples, context.sampleRate));
      },
      onError: () => {
        if (state.session === session) fail('A transmissão foi interrompida. Tente iniciar novamente ou escolha outra rádio.');
      },
    });
    state.streamSource = stream;
    state.gain = stream.gain;
    await stream.ready;
    return;
  }
  const audio = new Audio();
  audio.crossOrigin = 'anonymous';
  audio.preload = 'none';
  state.audio = audio;
  const source = context.createMediaElementSource(audio);
  const gain = context.createGain();
  gain.gain.value = 0;
  state.gain = gain;
  source.connect(gain).connect(context.destination);
  await context.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url));
  if (state.session !== session) return;
  const capture = new AudioWorkletNode(context, 'radio-capture');
  const silent = context.createGain();
  silent.gain.value = 0;
  source.connect(capture).connect(silent).connect(context.destination);
  state.capture = capture;
  capture.port.onmessage = ({ data }) => {
    if (state.session === session) collectSamples(resample(data, context.sampleRate));
  };
  audio.onerror = () => {
    if (state.session === session) fail('Não foi possível receber o áudio da rádio. A transmissão pode estar indisponível. Tente novamente ou abra o site oficial.');
  };
  audio.onwaiting = () => {
    if (state.running && state.session === session) status('Aguardando a transmissão da rádio', 'loading');
  };
  audio.onplaying = () => {
    if (state.running && state.session === session) status('Recebendo áudio e gerando legendas', 'live');
  };
  audio.src = STATIONS[state.station].stream;
  const played = audio.play();
  // A bounded connection wait prevents an unavailable stream from loading forever.
  let timeout;
  try {
    await Promise.race([played, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('stream-timeout')), 25000);
    })]);
  } finally { clearTimeout(timeout); }
}

async function startLive() {
  if (state.phase !== 'idle' || !STATIONS[state.station].stream) return;
  stop({ keepStatus: true });
  const session = state.session;
  clearError();
  clearCaptions();
  state.phase = 'loading';
  state.demo = false;
  state.progressFiles.clear();
  $('elapsed').textContent = '00:00';
  $('mode-label').textContent = 'LEGENDA AUTOMÁTICA · EXPERIMENTAL';
  $('mode-label').classList.remove('demo-note');
  $('progress-panel').hidden = false;
  $('model-progress').value = 0;
  $('progress-detail').textContent = state.workerReady ? 'Conectando à transmissão da rádio…' : 'Baixando e preparando o reconhecimento no aparelho. Primeiro uso: aproximadamente 60–110 MB; Precisão ampliada: cerca de 280 MB.';
  status('Preparando as legendas', 'loading');
  refreshControls();
  let stage = 'stream';
  try {
    await connectRadio(session);
    if (state.session !== session) return;
    stage = 'model';
    await ensureWorker();
    if (state.session !== session) return;
    state.running = true;
    state.phase = 'live';
    state.startedAt = Date.now();
    state.lastLevel = Date.now();
    $('progress-panel').hidden = true;
    $('pending-text').textContent = 'Recebendo áudio. As legendas aparecem automaticamente.';
    status('Recebendo áudio e gerando legendas', 'live');
    setFollowing(!(state.reading && state.readingHistory));
    state.clock = setInterval(() => { $('elapsed').textContent = elapsedTime((Date.now() - state.startedAt) / 1000); }, 1000);
    state.waitingTimer = setInterval(() => {
      if (Date.now() - state.lastLevel > 18000) {
        status('Aguardando áudio com volume suficiente', 'loading');
        $('pending-text').textContent = 'Ainda não recebemos áudio utilizável. Se continuar assim, tente reconectar ou consulte o site oficial.';
      }
    }, 5000);
    refreshControls();
  } catch (error) {
    if (state.session !== session) return;
    console.error('Falha ao iniciar:', error);
    if (error.message === 'unsupported') {
      fail('Este navegador não oferece os recursos necessários. Abra o site em um navegador atualizado. A demonstração continua disponível.');
    } else if (error.name === 'NotAllowedError') {
      fail('O navegador bloqueou o início do áudio. Clique em Tentar novamente para autorizar a reprodução. O som continuará desligado.');
    } else if (stage === 'model') {
      fail('Não foi possível preparar o reconhecimento. Confira a conexão ou escolha “Mais leve”. O primeiro download precisa de espaço e pode levar alguns minutos.');
    } else {
      fail('Não foi possível conectar à rádio. Tente novamente ou verifique a transmissão no site oficial da emissora.');
    }
  }
}

const DEMO_LINES = [
  'Esta é uma demonstração fictícia de como as legendas aparecerão. Nenhum áudio de rádio está sendo transcrito agora.',
  'Imagine acompanhar as notícias de Campinas, as entrevistas e as informações da sua cidade pela leitura.',
  'Você pode aumentar as letras, ativar o alto contraste e pausar a rolagem para ler no seu ritmo.',
  'Para testar a transmissão real, encerre esta demonstração e escolha “Iniciar legendas”.',
];

function startDemo() {
  if (state.phase !== 'idle') return;
  stop({ keepStatus: true });
  clearError();
  clearCaptions();
  state.demo = true;
  state.running = true;
  state.phase = 'demo';
  state.startedAt = Date.now();
  $('mode-label').textContent = 'DEMONSTRAÇÃO · TEXTO FICTÍCIO';
  $('mode-label').classList.add('demo-note');
  $('pending-text').textContent = 'Exemplo de leitura. Nenhuma notícia ou transmissão real está sendo exibida.';
  status('Demonstração com texto fictício', 'demo');
  setFollowing(!(state.reading && state.readingHistory));
  let index = 0;
  const session = state.session;
  const next = () => {
    if (state.session !== session || !state.demo) return;
    appendCaption(DEMO_LINES[index++]);
    $('elapsed').textContent = elapsedTime((Date.now() - state.startedAt) / 1000);
    if (index < DEMO_LINES.length) {
      state.demoTimer = setTimeout(next, 3200);
    } else {
      stop({ keepStatus: true });
      status('Demonstração concluída · texto fictício', 'demo');
      $('mode-label').textContent = 'DEMONSTRAÇÃO · TEXTO FICTÍCIO';
      $('pending-text').textContent = 'Estes textos são fictícios. Inicie as legendas para testar a rádio de verdade.';
    }
  };
  next();
  refreshControls();
}

function selectStation(id) {
  if (!STATIONS[id] || id === state.station) return;
  stop({ keepStatus: true });
  state.station = id;
  clearError();
  clearCaptions();
  $('mode-label').textContent = 'LEGENDA AUTOMÁTICA · EXPERIMENTAL';
  $('mode-label').classList.remove('demo-note');
  renderStation();
}

function renderStation() {
  const station = STATIONS[state.station];
  for (const button of document.querySelectorAll('[data-station]')) {
    const selected = button.dataset.station === state.station;
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('is-active', selected);
  }
  $('station-title').textContent = station.name;
  $('station-frequency').textContent = station.frequency;
  $('station-description').textContent = station.description;
  $('station-link').href = station.website;
  $('elapsed').textContent = '00:00';
  status(station.stream ? 'Pronto para começar' : 'Integração ainda indisponível');
  refreshControls();
}

function adjustSize(delta) {
  state.size = Math.max(20, Math.min(42, state.size + delta));
  document.documentElement.style.setProperty('--caption-size', `${state.size}px`);
  $('font-value').textContent = `${state.size}px`;
  $('font-down').disabled = state.size <= 20;
  $('font-up').disabled = state.size >= 42;
  try { localStorage.setItem('radio-text-size', String(state.size)); } catch { /* Optional preferences. */ }
}

function downloadTranscript() {
  if (!state.captions.length) return;
  const demo = state.captions.some(caption => caption.demo);
  const header = demo ? 'DEMONSTRAÇÃO FICTÍCIA — Não é uma transcrição de rádio.' : `Rádio em Texto — ${STATIONS[state.station].name}\nTranscrição automática experimental. Pode conter erros e omissões.`;
  const text = `${header}\n${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n\n` + state.captions.map(caption => `[${caption.time}] ${caption.text}`).join('\n\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `radio-em-texto-${demo ? 'demonstracao' : state.station}-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('reading-btn').addEventListener('click', () => setReadingMode(true));
$('exit-reading-btn').addEventListener('click', () => setReadingMode(false));
$('reading-history-btn').addEventListener('click', () => setReadingHistory(true));
$('current-caption-btn').addEventListener('click', () => setReadingHistory(false));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.reading && !$('help-dialog').open) setReadingMode(false);
});
$('start-btn').addEventListener('click', startLive);
$('stop-btn').addEventListener('click', () => stop());
$('demo-btn').addEventListener('click', startDemo);
$('retry-btn').addEventListener('click', startLive);
for (const button of document.querySelectorAll('[data-station]')) button.addEventListener('click', () => selectStation(button.dataset.station));
$('sound-btn').addEventListener('click', () => {
  if (!state.gain || !state.running) return;
  state.sound = !state.sound;
  state.gain.gain.setTargetAtTime(state.sound ? 0.8 : 0, state.context.currentTime, 0.02);
  refreshControls();
});
$('font-down').addEventListener('click', () => adjustSize(-2));
$('font-up').addEventListener('click', () => adjustSize(2));
$('contrast-btn').addEventListener('click', () => {
  const enabled = document.body.classList.toggle('high-contrast');
  $('contrast-btn').setAttribute('aria-pressed', String(enabled));
  try { localStorage.setItem('radio-high-contrast', String(enabled)); } catch { /* Optional preferences. */ }
});
$('scroll-btn').addEventListener('click', () => setFollowing(!state.following));
$('jump-btn').addEventListener('click', () => setFollowing(true));
// Reading gestures never disable automatic following; only the explicit control does.
$('clear-btn').addEventListener('click', clearCaptions);
$('download-btn').addEventListener('click', downloadTranscript);
$('model-select')?.addEventListener('change', event => {
  if (state.phase !== 'idle') return;
  const choice = event.target.value;
  if (!['base', 'tiny', 'small'].includes(choice) || choice === state.model) return;
  state.model = choice;
  state.worker?.terminate();
  state.worker = null;
  state.workerReady = false;
  state.workerBusy = false;
  state.init = null;
  clearError();
  status('Reconhecimento selecionado. Pronto para começar.');
});
$('help-btn').addEventListener('click', () => $('help-dialog').showModal());
$('close-help').addEventListener('click', () => $('help-dialog').close());
$('help-dialog').addEventListener('click', event => { if (event.target === $('help-dialog')) $('help-dialog').close(); });
if (!document.fullscreenEnabled) $('fullscreen-btn').hidden = true;
$('fullscreen-btn').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('reader-panel').requestFullscreen();
  } catch { $('pending-text').textContent = 'A tela cheia não está disponível neste navegador.'; }
});
document.addEventListener('fullscreenchange', () => {
  $('fullscreen-btn').setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.running && !state.demo) {
    $('pending-text').textContent = 'Ao voltar, confira a continuidade: o navegador pode suspender o áudio quando esta aba fica em segundo plano.';
  }
});
window.addEventListener('pagehide', () => stop({ keepStatus: true }));

try {
  const saved = Number(localStorage.getItem('radio-text-size'));
  if (saved >= 20 && saved <= 42) state.size = saved;
  if (localStorage.getItem('radio-high-contrast') === 'true') {
    document.body.classList.add('high-contrast');
    $('contrast-btn').setAttribute('aria-pressed', 'true');
  }
} catch { /* The app also works with browser storage disabled. */ }
adjustSize(0);
renderStation();

// Keep following as fonts load, the viewport changes or caption layout settles.
if (typeof ResizeObserver !== 'undefined') {
  const observer = new ResizeObserver(() => followLatest());
  observer.observe($('transcript-list'));
  observer.observe($('transcript'));
  observer.observe($('draft-text'));
}
setFollowing(true);
