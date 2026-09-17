"""Test the installed engine with a local WAV: python scripts/smoke-voice.py path.wav [pt]."""
import argparse
import json
import pathlib
import socket
import subprocess
import sys
import time
import urllib.request
import uuid

root = pathlib.Path(__file__).resolve().parent.parent
(root / 'test-results').mkdir(exist_ok=True)
runtime = root / 'src-tauri' / 'runtime'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('audio')
parser.add_argument('language', nargs='?', default='pt')
parser.add_argument('--gpu', action='store_true')
parser.add_argument('--model', choices=['small', 'large-v3-turbo-q5_0'])
args = parser.parse_args()
model = json.loads((runtime / 'model.json').read_text(encoding='utf-8-sig'))['file']
if args.model:
    model = f'ggml-{args.model}.bin'
audio = pathlib.Path(args.audio).read_bytes()
language = args.language
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
route = '/' + uuid.uuid4().hex
url = f'http://127.0.0.1:{port}{route}'
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
started = time.perf_counter()
with open(root / 'test-results' / ('whisper-smoke-gpu.log' if args.gpu else 'whisper-smoke.log'), 'w') as log:
    process = subprocess.Popen([str(runtime / ('vulkan/whisper-server.exe' if args.gpu else 'whisper-server.exe')), '-m', str(runtime / model), '--host', '127.0.0.1', '--port', str(port), '--request-path', route, '-nt', '-t', '8'] + ([] if args.gpu else ['-ng']), cwd=(runtime / 'vulkan' if args.gpu else runtime), stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        for _ in range(180):
            if process.poll() is not None:
                raise RuntimeError('Whisper exited before becoming ready; check test-results/whisper-smoke.log')
            try:
                opener.open(url + "/health", timeout=1)
                break
            except OSError:
                time.sleep(.5)
        else:
            raise TimeoutError('Whisper startup timed out')
        print(f'Load: {time.perf_counter() - started:.2f}s', flush=True)
        for attempt in range(2):
            boundary = uuid.uuid4().hex
            body = f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode() + audio + b'\r\n'
            for key, value in [('language', language), ('response_format', 'json'), ('temperature', '0.0')]:
                body += f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
            body += f'--{boundary}--\r\n'.encode()
            request = urllib.request.Request(url + '/inference', data=body, headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
            started = time.perf_counter()
            with opener.open(request, timeout=300) as response:
                result = json.load(response)
            assert result.get('text', '').strip(), result
            print(json.dumps({'attempt': attempt + 1, 'seconds': round(time.perf_counter() - started, 2), 'text': result['text']}, ensure_ascii=False), flush=True)
    finally:
        process.terminate()
        process.wait(timeout=10)
