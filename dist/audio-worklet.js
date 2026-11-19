class RadioCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(4096);
    this.offset = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i];
      this.samples[this.offset++] = value / channels.length;
      if (this.offset === this.samples.length) {
        const buffer = this.samples;
        this.port.postMessage(buffer, [buffer.buffer]);
        this.samples = new Float32Array(4096);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('radio-capture', RadioCapture);
