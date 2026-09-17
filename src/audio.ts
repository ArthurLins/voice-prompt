export const MAX_RECORDING_SECONDS = 30 * 60;
export function encodeWav(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2),
    view = new DataView(bytes.buffer);
  const str = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++)
      view.setUint8(offset + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const s = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, Math.round(s * (s < 0 ? 32768 : 32767)), true);
  });
  return bytes;
}
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export class VoiceRecorder {
  private stream?: MediaStream;
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private chunks: Float32Array[] = [];
  private frames = 0;
  private done?: () => void;
  async start(
    deviceId: string,
    onLevel: (level: number) => void,
    onDisconnect: () => void,
  ) {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.stream.getAudioTracks()[0].onended = onDisconnect;
      this.context = new AudioContext();
      await this.context.audioWorklet.addModule("/recorder.worklet.js");
      this.node = new AudioWorkletNode(this.context, "voice-recorder");
      this.node.port.onmessage = (e) => {
        if (e.data.done) {
          this.done?.();
          return;
        }
        const samples: Float32Array = e.data.samples;
        if (this.frames < this.context!.sampleRate * MAX_RECORDING_SECONDS) {
          const remaining =
            this.context!.sampleRate * MAX_RECORDING_SECONDS - this.frames;
          const captured = samples.subarray(0, remaining);
          this.chunks.push(captured);
          this.frames += captured.length;
        }
        let sum = 0;
        for (const x of samples) sum += x * x;
        onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 7));
      };
      const source = this.context.createMediaStreamSource(this.stream),
        mute = this.context.createGain();
      mute.gain.value = 0;
      source.connect(this.node);
      this.node.connect(mute);
      mute.connect(this.context.destination);
      await this.context.resume();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  async stop(): Promise<string> {
    const context = this.context;
    if (!context || !this.node) throw new Error("Microphone not started.");
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () =>
          reject(
            new Error(
              "Could not finish the audio recording. Please try again.",
            ),
          ),
        3000,
      );
      this.done = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.node!.port.postMessage("stop");
    }).catch(() => {
      // Keep frames already received if the device/worklet stopped responding.
    });
    const samples = new Float32Array(this.frames);
    let offset = 0;
    for (const chunk of this.chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    const rate = context.sampleRate;
    this.dispose();
    if (samples.length < rate * 0.3)
      throw new Error("Recording too short. Speak for at least one second.");
    let energy = 0;
    for (const x of samples) energy += x * x;
    if (Math.sqrt(energy / samples.length) < 0.002)
      throw new Error(
        "The microphone captured silence. Check the selected device.",
      );
    const offline = new OfflineAudioContext(
      1,
      Math.ceil((samples.length * 16000) / rate),
      16000,
    );
    const buffer = offline.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples, 0);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return toBase64(encodeWav(rendered.getChannelData(0)));
  }
  dispose() {
    this.stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    if (this.node) this.node.port.onmessage = null;
    this.node?.disconnect();
    if (this.context) void this.context.close().catch(() => {});
    this.stream = undefined;
    this.context = undefined;
    this.node = undefined;
    this.chunks = [];
    this.frames = 0;
  }
}
