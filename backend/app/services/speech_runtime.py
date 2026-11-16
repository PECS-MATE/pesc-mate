"""Select a private speech worker without breaking existing Melo-only installs."""
import os


def speech_runtime():
    if os.environ.get('SPEECH_TTS_PROVIDER') == 'qwen-api':
        return 'https://dashscope-intl.aliyuncs.com/api/v1', 'qwen-api'
    base = os.environ.get('SPEECH_TTS_URL', '').rstrip('/')
    if base:
        provider = os.environ.get('SPEECH_TTS_PROVIDER', 'melotts')
        if provider not in {'melotts', 'qwen3-tts'}:
            return '', 'unsupported'
        return base, provider
    return os.environ.get('MELO_TTS_URL', '').rstrip('/'), 'melotts'
