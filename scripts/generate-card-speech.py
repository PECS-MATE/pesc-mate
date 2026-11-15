"""Generate the public catalog with the existing local Qwen child voices; no build."""
import argparse
import ast
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import wave

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'frontend/public/audio/core/v2'
STAGING = ROOT / '.local-validation/card-speech-assets/v2'
REMOTE = """
import json, sys, urllib.request
payload = sys.stdin.buffer.read()
request = urllib.request.Request('http://127.0.0.1:8090/speech', data=payload,
    headers={'Content-Type': 'application/json'})
with urllib.request.urlopen(request, timeout=180) as response:
    sys.stdout.buffer.write(response.read(1024 * 1024 + 1))
"""


def catalog():
    tree = ast.parse((ROOT / 'backend/app/services/communication.py').read_text(encoding='utf-8'))
    assignment = next(node for node in tree.body if isinstance(node, ast.Assign)
                      and any(isinstance(target, ast.Name) and target.id == 'CARDS' for target in node.targets))
    rows = ast.literal_eval(assignment.value.generators[0].iter.args[0])
    return [{'id': row[0], 'text': row[1], 'file': row[0] + '.wav'} for row in rows]


def valid_audio(data):
    if len(data) > 1024 * 1024:
        return False
    try:
        with wave.open(io.BytesIO(data), 'rb') as audio:
            frames = audio.readframes(audio.getnframes())
            return (audio.getnchannels() == 1 and audio.getsampwidth() == 2
                    and .15 <= audio.getnframes() / audio.getframerate() <= 20
                    and len(frames) == audio.getnframes() * 2 and any(frames))
    except (wave.Error, EOFError):
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', default='pesc-mate-qwen-tts-1')
    parser.add_argument('--deadline-seconds', type=int, default=10800)
    parser.add_argument('--deadline-at', type=float, help='Carry the original absolute deadline when resuming')
    parser.add_argument('--status', action='store_true', help='Inspect saved clips without starting synthesis')
    args = parser.parse_args()
    if args.status:
        entries = catalog()
        ready = sum(1 for voice in ['girl', 'boy'] for entry in entries
                    if (STAGING / voice / entry['file']).exists()
                    and valid_audio((STAGING / voice / entry['file']).read_bytes()))
        print(json.dumps({'prepared': ready, 'total': len(entries) * 2,
                          'published': (OUTPUT / 'manifest.json').exists()}))
        return
    started = time.time()
    deadline = min(started + args.deadline_seconds, args.deadline_at) if args.deadline_at else started + args.deadline_seconds
    report_path = ROOT / '.local-validation/card-speech-run.json'
    checkpoint_path = ROOT / '.local-validation/card-speech-source.json'
    report_path.parent.mkdir(parents=True, exist_ok=True)
    entries = catalog()
    manifest = {'version': 'v2', 'provider': 'qwen3-tts', 'rate': 1,
                'voices': ['girl', 'boy'], 'entries': entries}
    report = {'pid': os.getpid(), 'container': args.container, 'started': started,
              'deadline': deadline, 'parallelism': 1, 'attempts_per_clip': 2,
              'cpu_limit': 2, 'memory_limit_gib': 8, 'total': len(entries) * 2,
              'completed': 0, 'status': 'running', 'output': str(OUTPUT)}

    def save_report():
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')

    def execute(code, payload=b'', timeout=200):
        remaining = deadline - time.time()
        if remaining <= 0:
            raise TimeoutError('Generation deadline exceeded')
        return subprocess.run(['docker', 'exec', '-i', args.container, 'python', '-c', code],
                              input=payload, capture_output=True, timeout=min(timeout, remaining), check=True).stdout

    save_report()
    try:
        # Startup is part of the same absolute deadline; do not download or build here.
        health = None
        while time.time() < min(deadline, started + 900):
            try:
                health = json.loads(execute("import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8090/health', timeout=3).read().decode())", timeout=10))
                if health.get('provider') == 'qwen3-tts' and set(health.get('voices', [])) >= {'girl', 'boy'}:
                    break
            except (subprocess.SubprocessError, json.JSONDecodeError):
                pass
            time.sleep(5)
        else:
            raise RuntimeError('Qwen child voices did not become ready')
        manifest['voice_version'] = health['voice_version']
        STAGING.mkdir(parents=True, exist_ok=True)
        # A manifest is published only after every referenced file is validated.
        existing_path = OUTPUT / 'manifest.json'
        existing = json.loads(existing_path.read_text(encoding='utf-8')) if existing_path.exists() else {}
        fingerprint = hashlib.sha256(json.dumps(manifest, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        same_voice = (existing.get('voice_version') == manifest['voice_version']
                      and existing.get('entries') == entries and existing.get('rate') == 1
                      and existing.get('version') == 'v2' and existing.get('provider') == 'qwen3-tts')
        checkpoint_path.write_text(json.dumps({'fingerprint': fingerprint, 'voice_version': manifest['voice_version'],
                                              'output': str(OUTPUT), 'deadline': deadline}, indent=2), encoding='utf-8')
        for voice in manifest['voices']:
            folder = STAGING / voice
            folder.mkdir(exist_ok=True)
            for entry in entries:
                output = folder / entry['file']
                provenance = output.with_suffix('.json')
                try:
                    same_clip = json.loads(provenance.read_text(encoding='utf-8')).get('fingerprint') == fingerprint
                except (OSError, ValueError, AttributeError):
                    same_clip = False
                published = OUTPUT / voice / entry['file']
                if same_voice and not same_clip and published.exists() and valid_audio(published.read_bytes()):
                    shutil.copyfile(published, output)
                    provenance.write_text(json.dumps({'fingerprint': fingerprint}), encoding='utf-8')
                    same_clip = True
                if not (same_clip and output.exists() and valid_audio(output.read_bytes())):
                    for attempt in range(2):
                        payload = json.dumps({'text': entry['text'], 'voice': voice, 'rate': 1}, ensure_ascii=False).encode()
                        try:
                            data = execute(REMOTE, payload)
                            if not valid_audio(data):
                                raise ValueError('Invalid, silent or overlong WAV')
                            temporary = output.with_suffix('.writing')
                            temporary.write_bytes(data)
                            temporary.replace(output)
                            provenance.write_text(json.dumps({'fingerprint': fingerprint}), encoding='utf-8')
                            break
                        except (subprocess.SubprocessError, ValueError):
                            if attempt == 1:
                                raise
                report['completed'] += 1
                report['last'] = f"{voice}/{entry['id']}"
                save_report()
                print(f"{report['completed']}/{report['total']} {report['last']}", flush=True)
        OUTPUT.mkdir(parents=True, exist_ok=True)
        for voice in manifest['voices']:
            (OUTPUT / voice).mkdir(exist_ok=True)
            for entry in entries:
                target = OUTPUT / voice / entry['file']
                temporary = target.with_suffix('.writing')
                shutil.copyfile(STAGING / voice / entry['file'], temporary)
                temporary.replace(target)
        temporary = OUTPUT / 'manifest.writing'
        temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        temporary.replace(existing_path)
        report['status'] = 'complete'
    except BaseException as error:
        report['status'] = 'failed'
        report['error'] = type(error).__name__
        raise
    finally:
        report['elapsed_seconds'] = round(time.time() - started, 2)
        save_report()


if __name__ == '__main__':
    main()
