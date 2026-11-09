"""Opt-in CPU VoiceDesign audition. Never replaces application audio automatically."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import signal
import sys
import time
import uuid

MODEL_ID = 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign'
GIB = 1024 ** 3
# Conservative project preflight, not a vendor minimum. CPU BF16 is measured separately.
MIN_TOTAL = 8 * GIB
MIN_AVAILABLE = 6 * GIB


def memory_status():
    fields = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        key, value = line.split(':', 1)
        fields[key] = int(value.strip().split()[0]) * 1024
    total = fields['MemTotal']
    available = fields['MemAvailable']
    # Respect Docker's memory limit, including cgroup v1 hosts.
    for limit_path, used_path in (
        ('/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory.current'),
        ('/sys/fs/cgroup/memory/memory.limit_in_bytes',
         '/sys/fs/cgroup/memory/memory.usage_in_bytes'),
    ):
        try:
            limit = int(Path(limit_path).read_text().strip())
            used = int(Path(used_path).read_text().strip())
        except (OSError, ValueError):
            continue
        total = min(total, limit)
        available = min(available, max(0, limit - used))
    return total, available


def preflight():
    total, available = memory_status()
    print(f'Docker memory: total={total / GIB:.2f}GiB, available={available / GIB:.2f}GiB', flush=True)
    if total < MIN_TOTAL or available < MIN_AVAILABLE:
        raise RuntimeError('샘플 실행 보류: 총 8GiB·가용 6GiB 이상이 필요합니다. '
                           '프로젝트의 보수적인 사전 기준이며 성공 보장은 아닙니다. '
                           'Docker 메모리를 늘린 뒤 다시 점검하세요. 모델은 다운로드하지 않았습니다.')


def deadline(_signum, _frame):
    raise TimeoutError('샘플 작업 제한 시간을 초과했습니다.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='메모리 점검만 수행, 모델 다운로드 없음')
    parser.add_argument('--text', default='물 주세요. 도와주세요. 잠깐만요.')
    parser.add_argument('--description-file', default='/app/voice-description.txt')
    parser.add_argument('--output-dir', default='/output')
    parser.add_argument('--timeout-seconds', type=int, default=900)
    parser.add_argument('--dtype', choices=['bfloat16', 'float32'], default='bfloat16')
    args = parser.parse_args()
    if not 30 <= args.timeout_seconds <= 3600:
        parser.error('제한 시간은 30~3600초입니다.')
    preflight()
    if args.check:
        print('사전 점검 통과. 실제 합성 속도와 음색은 아직 검증되지 않았습니다.')
        return
    text = args.text.strip()
    description = Path(args.description_file).read_text(encoding='utf-8-sig').strip()
    if not text or len(text) > 100 or not description or len(description) > 2000:
        parser.error('샘플 문장은 1~100자, 음색 설명은 1~2000자입니다.')
    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(args.timeout_seconds)
    started = time.monotonic()
    # Heavy imports and model downloads only after the memory/input checks.
    import numpy as np
    import soundfile as sf
    import torch
    from huggingface_hub import snapshot_download
    from qwen_tts import Qwen3TTSModel

    torch.set_num_threads(2)
    revision = os.environ.get('QWEN_MODEL_REVISION', 'main')
    snapshot = snapshot_download(MODEL_ID, revision=revision)
    model = Qwen3TTSModel.from_pretrained(snapshot, device_map='cpu',
                                         dtype=getattr(torch, args.dtype), attn_implementation='sdpa')
    loaded = time.monotonic()
    print('모델 준비 완료. 샘플 합성 중입니다.', flush=True)
    torch.manual_seed(42)
    with torch.inference_mode():
        wavs, sample_rate = model.generate_voice_design(
            text=text, language='Korean', instruct=description, max_new_tokens=512)
    audio = np.asarray(wavs[0], dtype=np.float32)
    if audio.ndim != 1 or not len(audio) or not np.isfinite(audio).all():
        raise RuntimeError('유효한 단일 채널 음성을 얻지 못했습니다.')
    peak = float(np.max(np.abs(audio)))
    if peak < 0.0001:
        raise RuntimeError('샘플이 무음입니다.')
    if peak > 1:
        audio = audio / peak * 0.98
    duration = len(audio) / sample_rate
    if not math.isfinite(duration) or not 0 < duration <= 45:
        raise RuntimeError('샘플 길이가 허용 범위를 벗어났습니다.')
    # Unique directories preserve all earlier auditions; no public asset writes.
    output = Path(args.output_dir) / ('audition-' + uuid.uuid4().hex[:12])
    output.mkdir(parents=True, exist_ok=False)
    sf.write(output / 'sample.wav', audio, sample_rate, subtype='PCM_16')
    metadata = dict(model=MODEL_ID, revision=Path(snapshot).name, dtype=args.dtype,
                    description=description, text=text, seed=42,
                    description_sha256=hashlib.sha256(description.encode()).hexdigest(),
                    load_seconds=round(loaded - started, 2),
                    synthesis_seconds=round(time.monotonic() - loaded, 2),
                    audio_seconds=round(duration, 2), sample_rate=sample_rate,
                    peak_before_normalization=peak,
                    status='generated-not-listening-approved',
                    warning='음색·발음·누락·문장 끝 잘림은 직접 청취가 필요합니다. 서비스에 적용되지 않았습니다.')
    (output / 'metadata.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    signal.alarm(0)
    print(f'샘플 저장: {output}/sample.wav', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, TimeoutError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
