class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = 0;
    this.active = true;
    this.port.onmessage = (e) => {
      if (e.data === "stop") {
        this.flush();
        this.active = false;
        this.port.postMessage({ done: true });
      }
    };
  }
  flush() {
    if (!this.offset) return;
    const samples = this.buffer.slice(0, this.offset);
    this.port.postMessage({ samples }, [samples.buffer]);
    this.offset = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (this.active && channels?.length) {
      for (let i = 0; i < channels[0].length; i++) {
        let sample = 0;
        for (const channel of channels) sample += channel[i] / channels.length;
        this.buffer[this.offset++] = sample;
        if (this.offset === this.buffer.length) this.flush();
      }
    }
    return this.active;
  }
}
registerProcessor("voice-recorder", RecorderProcessor);
