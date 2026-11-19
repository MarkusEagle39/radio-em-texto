// Feed decoded PCM through the same capture worklet used by the normal player.
// This avoids Safari's silent MediaElementAudioSourceNode for live AAC streams.
export function createDecodedStream(context, url, { onSamples, onError }) {
  const gain = context.createGain();
  gain.gain.value = 0;
  gain.connect(context.destination);
  const sources = new Set();
  let worker, capture, silent, timer, acknowledgement;
  let stopped = false;
  let connected = false;
  let nextAt = 0;
  let resolve, reject;
  const ready = new Promise((yes, no) => { resolve = yes; reject = no; });

  function stop(reason = new Error('cancelled')) {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    clearTimeout(acknowledgement);
    worker?.terminate();
    if (capture) {
      capture.port.onmessage = null;
      capture.disconnect();
    }
    for (const source of sources) { try { source.stop(); } catch { /* Already ended. */ } }
    sources.clear();
    silent?.disconnect();
    gain.disconnect();
    if (!connected) reject(reason);
  }

  function fail(error) {
    if (stopped) return;
    const wasConnected = connected;
    stop(error);
    if (wasConnected) onError(error);
    else reject(error);
  }

  async function initialize() {
    await context.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url));
    if (stopped) return;
    capture = new AudioWorkletNode(context, 'radio-capture');
    capture.port.onmessage = ({ data }) => { if (!stopped) onSamples(data); };
    silent = context.createGain();
    silent.gain.value = 0;
    capture.connect(silent).connect(context.destination);
    worker = new Worker(new URL('./stream-worker.js', import.meta.url), { type: 'module' });
    worker.onerror = () => fail(new Error('decoder-worker'));
    worker.onmessage = ({ data }) => {
      if (stopped) return;
      if (data.type === 'error') { fail(new Error(data.message)); return; }
      if (data.type !== 'pcm' || !data.channelData?.length || !data.channelData[0].length) return;
      try {
        const length = data.channelData[0].length;
        const buffer = context.createBuffer(data.channelData.length, length, data.sampleRate);
        data.channelData.forEach((channel, index) => buffer.copyToChannel(channel, index));
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        source.connect(capture);
        sources.add(source);
        source.onended = () => { sources.delete(source); source.disconnect(); };
        const startAt = Math.max(nextAt, context.currentTime + 0.05);
        source.start(startAt);
        nextAt = startAt + buffer.duration;
        // Backpressure keeps the live stream close to real time and bounds memory.
        acknowledgement = setTimeout(() => {
          if (!stopped) worker.postMessage({ type: 'pull' });
        }, Math.max(0, (nextAt - context.currentTime - 2) * 1000));
        if (!connected) {
          connected = true;
          clearTimeout(timer);
          resolve();
        }
      } catch (error) { fail(error); }
    };
    worker.postMessage({ type: 'start', url });
  }

  timer = setTimeout(() => fail(new Error('stream-timeout')), 25000);
  initialize().catch(fail);
  return { gain, ready, stop };
}
