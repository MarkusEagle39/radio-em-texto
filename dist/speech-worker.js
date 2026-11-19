// The model runs on the visitor's device. This is not an OpenAI API client.
let model;
let initializing;
let busy = false;
let Streamer;
const MODELS = { tiny: 'onnx-community/whisper-tiny', base: 'onnx-community/whisper-base', small: 'onnx-community/whisper-small' };

async function initialize(modelType = 'base') {
  if (model) return;
  if (initializing) return initializing;
  initializing = (async () => {
    const { pipeline, env, TextStreamer } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
    Streamer = TextStreamer;
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    env.backends.onnx.wasm.numThreads = 1;
    model = await pipeline('automatic-speech-recognition', MODELS[modelType] || MODELS.base, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: progress => {
        self.postMessage({ type: 'progress', progress: {
          status: progress.status,
          file: progress.file,
          loaded: progress.loaded,
          total: progress.total,
          progress: progress.progress,
        } });
      },
    });
  })();
  try { await initializing; } catch (error) { initializing = null; throw error; }
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      await initialize(data.model);
      self.postMessage({ type: 'ready' });
    }
    if (data.type === 'transcribe' && !busy) {
      busy = true;
      try {
        await initialize();
        let draft = '';
        const streamer = new Streamer(model.tokenizer, {
          skip_prompt: true,
          skip_special_tokens: true,
          callback_function: text => {
            draft += text;
            self.postMessage({ type: 'partial', text: draft, session: data.session,
              audioTime: data.audioTime, stepSeconds: data.stepSeconds,
              capturedAt: data.capturedAt });
          },
        });
        const output = await model(data.audio, {
          streamer,
          language: 'portuguese',
          task: 'transcribe',
          return_timestamps: false,
          max_new_tokens: 160,
          // Preserve literal repetitions and numbers. Obvious decoding loops
          // are handled separately by the caption quality check.
          temperature: 0,
          do_sample: false,
        });
        self.postMessage({ type: 'result', text: output.text, session: data.session,
          audioTime: data.audioTime, stepSeconds: data.stepSeconds, capturedAt: data.capturedAt,
          processingMs: Date.now() - data.sentAt });
      } finally { busy = false; }
    }
  } catch (error) {
    self.postMessage({ type: 'error', session: data.session,
      message: String(error?.message || 'Não foi possível executar o reconhecimento de fala.').slice(0, 400) });
  }
};
