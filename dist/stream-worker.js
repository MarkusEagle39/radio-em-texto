// Streaming decoders run separately from speech recognition and the page UI.
let pull;
let started = false;

async function receive(url) {
  let decoder, reader;
  const controller = new AbortController();
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit', signal: controller.signal });
    if (!response.ok || !response.body) throw new Error('stream-unavailable');
    const type = response.headers.get('content-type') || '';
    if (/aac/i.test(type)) {
      const { AACDecoder } = await import('https://cdn.jsdelivr.net/npm/@wasm-audio-decoders/aac@0.0.1/+esm');
      decoder = new AACDecoder();
    } else if (/mpeg|mp3/i.test(type)) {
      const { MPEGDecoder } = await import('https://cdn.jsdelivr.net/npm/mpg123-decoder@1.0.3/+esm');
      decoder = new MPEGDecoder();
    } else {
      throw new Error('unsupported-stream-format');
    }
    await decoder.ready;
    reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error('stream-ended');
      // A server can deliver a burst on connection; decode bounded pieces.
      for (let offset = 0; offset < value.length; offset += 16384) {
        const decoded = await decoder.decode(value.subarray(offset, offset + 16384));
        if (!decoded.samplesDecoded) continue;
        const resume = new Promise(resolve => { pull = resolve; });
        self.postMessage({ type: 'pcm', channelData: decoded.channelData, sampleRate: decoded.sampleRate },
          decoded.channelData.map(channel => channel.buffer));
        await resume;
      }
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error.message || error).slice(0, 200) });
  } finally {
    controller.abort();
    reader?.releaseLock();
    decoder?.free();
  }
}

self.onmessage = ({ data }) => {
  if (data.type === 'pull') { pull?.(); pull = null; }
  if (data.type === 'start' && !started) {
    started = true;
    receive(data.url);
  }
};
