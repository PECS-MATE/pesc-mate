"""Internal Korean MeloTTS worker. No public port, database or text logging."""
from contextlib import asynccontextmanager, redirect_stdout
from io import BytesIO, StringIO
import logging
import os
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from starlette.responses import Response

gate = Lock()
model = None
logger = logging.getLogger('uvicorn.error')


def synthesize(text, rate):
    import soundfile
    # Upstream helpers can print sentence/phoneme text; suppress stdout for private input.
    with redirect_stdout(StringIO()):
        audio = model.tts_to_file(text, model.hps.data.spk2id['KR'], output_path=None,
                                  speed=rate, quiet=True)
    output = BytesIO()
    soundfile.write(output, audio, model.hps.data.sampling_rate, format='WAV', subtype='PCM_16')
    return output.getvalue()


@asynccontextmanager
async def lifespan(_app):
    global model
    # Existing model volumes predate this directory; keep the NLTK symlink valid.
    Path(os.environ.get('NLTK_DATA', '/models/nltk')).mkdir(parents=True, exist_ok=True)
    import torch
    from melo.api import TTS
    torch.set_num_threads(max(1, min(4, int(os.environ.get('MELO_THREADS', '2')))))
    model = TTS(language='KR', device='cpu')
    # Load tokenizers/pronunciation resources before accepting user requests.
    synthesize('안녕하세요.', 1.0)
    logger.info('TTS | READY | 한국어 로컬 음성 준비 완료')
    yield
    model = None


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=300)
    rate: float = Field(default=1.0, ge=0.5, le=1.5, allow_inf_nan=False)


@app.get('/health')
def health():
    if model is None:
        raise HTTPException(503, 'warming')
    return {'status': 'ready', 'provider': 'melotts', 'language': 'ko-KR'}


@app.post('/speech')
def speech(request: SpeechRequest):
    if not request.text.strip():
        raise HTTPException(422, '텍스트를 입력해 주세요.')
    if model is None:
        raise HTTPException(503, '음성 모델 준비 중입니다.')
    if not gate.acquire(blocking=False):
        raise HTTPException(429, '다른 음성을 만들고 있습니다. 잠시 후 다시 시도해 주세요.')
    try:
        wav = synthesize(request.text.strip(), request.rate)
        if len(wav) > 12 * 1024 * 1024:
            raise HTTPException(422, '음성이 너무 깁니다. 문장을 줄여 주세요.')
        return Response(wav, media_type='audio/wav', headers={'Cache-Control': 'no-store'})
    except HTTPException:
        raise
    except Exception as error:
        logger.warning('TTS | FAILED | %s', type(error).__name__)
        raise HTTPException(503, '로컬 음성 합성에 실패했습니다.') from None
    finally:
        gate.release()
