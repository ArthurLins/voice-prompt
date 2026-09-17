import { describe, expect, it } from "vitest";
import { encodeWav, toBase64 } from "./audio";
describe("local WAV audio transport", () => {
  it("encodes clipped mono PCM16 with a correct RIFF header", () => {
    const bytes = encodeWav(new Float32Array([-2, -1, 0, 1, 2]));
    const view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(10);
    expect([0, 1, 2, 3, 4].map((i) => view.getInt16(44 + i * 2, true))).toEqual(
      [-32768, -32768, 0, 32767, 32767],
    );
  });
  it("preserves bytes across large base64 chunks", () => {
    const bytes = new Uint8Array(30000).map((_, i) => i % 256);
    expect(
      Uint8Array.from(atob(toBase64(bytes)), (c) => c.charCodeAt(0)),
    ).toEqual(bytes);
  });
});
