"""Test the installed engine with a local WAV: python scripts/smoke-voice.py path.wav [pt]."""
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
model = json.loads((runtime / 'model.json').read_text(encoding='utf-8-sig'))['file']
audio = pathlib.Path(sys.argv[1]).read_bytes()
language = sys.argv[2] if len(sys.argv) > 2 else 'pt'
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
route = '/' + uuid.uuid4().hex
url = f'http://127.0.0.1:{port}{route}'
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
started = time.perf_counter()
with open(root / 'test-results' / 'whisper-smoke.log', 'w') as log:
    process = subprocess.Popen([str(runtime / 'whisper-server.exe'), '-m', model, '--host', '127.0.0.1', '--port', str(port), '--request-path', route, '-ng', '-nt', '-t', '8'], cwd=runtime, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
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
