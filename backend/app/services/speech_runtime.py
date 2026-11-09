"""Select a private speech worker without breaking existing Melo-only installs."""
import os


def speech_runtime():
    base = os.environ.get('SPEECH_TTS_URL', '').rstrip('/')
    if base:
        provider = os.environ.get('SPEECH_TTS_PROVIDER', 'melotts')
        if provider not in {'melotts', 'qwen3-tts'}:
            return '', 'unsupported'
        return base, provider
    return os.environ.get('MELO_TTS_URL', '').rstrip('/'), 'melotts'
