"""Private CPU Qwen speech worker using a locally designed synthetic reference."""
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO, StringIO
import hashlib
import json
import math
import os
from pathlib import Path
from threading import Lock

from generate import preflight

MODEL_ID = 'Qwen/Qwen3-TTS-12Hz-0.6B-Base'
gate = Lock()
model = None
prompts = {}
voice_version = None


def synthesize(text, rate, voice='girl'):
    import librosa
    import numpy as np
    import soundfile as sf
    import torch
    with torch.inference_mode(), redirect_stdout(StringIO()):
        torch.manual_seed(42)
        wavs, sample_rate = model.generate_voice_clone(
            text=text, language='Korean', voice_clone_prompt=prompts[voice], max_new_tokens=2048)
    audio = np.asarray(wavs[0], dtype=np.float32)
    if audio.ndim != 1 or not len(audio) or not np.isfinite(audio).all():
        raise ValueError('invalid audio')
    peak = float(np.max(np.abs(audio)))
    if peak < 0.0001:
        raise ValueError('silent audio')
    if rate != 1:
        audio = librosa.effects.time_stretch(audio, rate=rate)
    peak = float(np.max(np.abs(audio)))
    if peak > 1:
        audio = audio / peak * 0.98
    output = BytesIO()
    sf.write(output, audio, sample_rate, format='WAV', subtype='PCM_16')
    data = output.getvalue()
    if len(data) > 12 * 1024 * 1024:
        raise ValueError('oversized audio')
    return data


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # Do not log text, requests or credentials.

    def reply(self, code, data, content_type='application/json'):
        if content_type == 'application/json':
            data = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if self.path != '/health':
            return self.reply(404, {'detail': 'not found'})
        self.reply(200, {'status': 'ready', 'provider': 'qwen3-tts', 'language': 'ko-KR',
                         'voice_version': voice_version, 'voices': sorted(prompts)})

    def do_POST(self):
        if self.path != '/speech':
            return self.reply(404, {'detail': 'not found'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 8192:
                raise ValueError('body size')
            self.connection.settimeout(5)
            body = json.loads(self.rfile.read(size))
            text = body.get('text')
            rate = body.get('rate', 1.0)
            voice = body.get('voice', 'girl')
            if (not isinstance(text, str) or not 1 <= len(text.strip()) <= 300
                    or not isinstance(voice, str) or voice not in prompts
                    or isinstance(rate, bool) or not isinstance(rate, (int, float))
                    or not math.isfinite(rate) or not 0.5 <= rate <= 1.5):
                raise ValueError('invalid input')
        except (ValueError, AttributeError, OSError):
            return self.reply(422, {'detail': 'invalid input'})
        if not gate.acquire(blocking=False):
            return self.reply(429, {'detail': 'busy'})
        try:
            data = synthesize(text.strip(), rate, voice)
            self.reply(200, data, 'audio/wav')
        except Exception as error:
            print('QWEN | FAILED | ' + type(error).__name__, flush=True)
            self.reply(503, {'detail': 'synthesis failed'})
        finally:
            gate.release()


def main():
    global model, voice_version
    preflight()
    references = {}
    for voice, directory in (('girl', '/reference'), ('boy', '/reference-boy')):
        reference = Path(directory)
        # The original single-reference setup remains usable; never fake a boy voice.
        if voice == 'boy' and not (reference / 'metadata.json').is_file():
            continue
        metadata = json.loads((reference / 'metadata.json').read_text(encoding='utf-8'))
        if metadata.get('model') != 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign' or not metadata.get('text'):
            raise RuntimeError('VoiceDesign sample metadata required')
        references[voice] = (reference, metadata)
    voice_version = hashlib.sha256(b''.join(
        voice.encode() + (reference / 'sample.wav').read_bytes()
        for voice, (reference, _) in sorted(references.items()))).hexdigest()[:20]
    import torch
    from huggingface_hub import snapshot_download
    from qwen_tts import Qwen3TTSModel
    torch.set_num_threads(2)
    dtype = os.environ.get('QWEN_DTYPE', 'bfloat16')
    if dtype not in {'bfloat16', 'float32'}:
        raise RuntimeError('unsupported dtype')
    snapshot = snapshot_download(MODEL_ID, revision=os.environ.get('QWEN_BASE_REVISION', 'main'))
    model = Qwen3TTSModel.from_pretrained(snapshot,
        device_map='cpu', dtype=getattr(torch, dtype), attn_implementation='sdpa')
    with redirect_stdout(StringIO()), torch.inference_mode():
        for voice, (reference, metadata) in references.items():
            prompts[voice] = model.create_voice_clone_prompt(ref_audio=str(reference / 'sample.wav'),
                                                             ref_text=metadata['text'])
    synthesize('안녕하세요.', 0.9)  # Warm decoder and rate processing before readiness.
    print('QWEN | READY | synthetic reference=' + voice_version, flush=True)
    ThreadingHTTPServer(('0.0.0.0', 8090), Handler).serve_forever()


if __name__ == '__main__':
    main()
