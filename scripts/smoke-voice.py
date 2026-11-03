"""Test the private Whisper worker with a 16 kHz mono PCM WAV."""
import argparse
import json
import pathlib
import struct
import subprocess
import sys
import time
import wave

root = pathlib.Path(__file__).resolve().parent.parent
runtime = root / 'src-tauri' / 'runtime'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('audio')
parser.add_argument('language', nargs='?', default='pt', choices=['pt', 'en', 'es', 'auto'])
parser.add_argument('--gpu', action='store_true')
parser.add_argument('--model', choices=['small', 'large-v3-turbo-q5_0'])
parser.add_argument('--expect', help='Fail if the transcription does not contain this text')
args = parser.parse_args()
model = (f'ggml-{args.model}.bin' if args.model else
         json.loads((runtime / 'model.json').read_text(encoding='utf-8-sig'))['file'])
with wave.open(args.audio, 'rb') as audio:
    if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000):
        raise ValueError('Expected 16 kHz mono 16-bit PCM')
    pcm = audio.readframes(audio.getnframes())
language = ['pt', 'en', 'es', 'auto'].index(args.language)
request = struct.pack('<BI', language, len(pcm)) + pcm
worker = runtime / 'voice-prompt-whisper'
if sys.platform == 'win32':
    worker = runtime / ('voice-prompt-whisper-vulkan.exe' if args.gpu else 'voice-prompt-whisper.exe')
(root / 'test-results').mkdir(exist_ok=True)
log_name = 'whisper-smoke-gpu.log' if args.gpu else 'whisper-smoke.log'
started = time.perf_counter()
with open(root / 'test-results' / log_name, 'wb') as log:
    result = subprocess.run(
        [str(worker), str(runtime / model), '8', 'gpu' if args.gpu else 'cpu'],
        cwd=worker.parent, input=request * 2, stdout=subprocess.PIPE, stderr=log,
        timeout=300, check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
    )
if not result.stdout.startswith(b'VPW1'):
    raise RuntimeError('Invalid Whisper worker readiness response')
offset = 4
for attempt in range(2):
    size, = struct.unpack_from('<I', result.stdout, offset)
    offset += 4
    text = result.stdout[offset:offset + size].decode('utf-8').strip()
    offset += size
    if not text or (args.expect and args.expect.casefold() not in text.casefold()):
        raise AssertionError(f'Unexpected transcription: {text!r}')
    print(json.dumps({'attempt': attempt + 1, 'text': text}, ensure_ascii=False))
if offset != len(result.stdout):
    raise RuntimeError('Unexpected trailing data in worker response')
print(f'Load and transcribe twice: {time.perf_counter() - started:.2f}s')
