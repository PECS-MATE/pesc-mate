"""No network, credentials or paid requests needed: python -m unittest discover
-s tests -p test_qwen_cloud_speech.py
"""
from io import BytesIO
import json
import os
import unittest
from unittest.mock import patch, MagicMock
import wave

from fastapi import HTTPException
from app.services import qwen_cloud_speech as cloud, server_speech, health
from app.services.speech_cache import SpeechCache
from app.services.speech_runtime import speech_runtime


def wav_bytes():
    output = BytesIO()
    with wave.open(output, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24000)
        wav.writeframes(b'\x01\x00' * 100)
    return output.getvalue()


class QwenCloudTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            'SPEECH_TTS_PROVIDER': 'qwen-api', 'DASHSCOPE_API_KEY': 'synthetic-key',
            'QWEN_API_MODEL': 'qwen3-tts-flash', 'QWEN_API_GIRL_VOICE': 'Cherry',
            'QWEN_API_BOY_VOICE': 'Ethan', 'PUBLIC_SPEECH_CACHE_DIR': '',
        })
        self.env.start()
        self.addCleanup(self.env.stop)

    def opener(self, url):
        opener = MagicMock()
        opener.open.side_effect = [BytesIO(json.dumps({'output': {'audio': {'url': url}}}).encode()),
                                    BytesIO(wav_bytes())]
        return opener

    def test_korean_payload_and_no_key_forwarded_to_audio_download(self):
        opener = self.opener('http://dashscope-result.oss-ap-southeast-1.aliyuncs.com/a.wav?signature=x')
        with patch.object(cloud, 'build_opener', return_value=opener):
            self.assertEqual(cloud.synthesize('합성 예제', 'boy', 35), wav_bytes())
        first = opener.open.call_args_list[0].args[0]
        self.assertEqual(first.get_header('Authorization'), 'Bearer synthetic-key')
        self.assertEqual(json.loads(first.data)['input'], {
            'text': '합성 예제', 'voice': 'Ethan', 'language_type': 'Korean'})
        second = opener.open.call_args_list[1].args[0]
        self.assertTrue(second.full_url.startswith('https://'))
        self.assertIsNone(second.get_header('Authorization'))

    def test_missing_key_does_not_make_a_request(self):
        with patch.dict(os.environ, {'DASHSCOPE_API_KEY': ''}), patch.object(cloud, 'build_opener') as build:
            with self.assertRaises(ValueError):
                cloud.synthesize('예제', 'girl', 35)
            build.assert_not_called()

    def test_rejects_untrusted_audio_urls(self):
        for url in ('http://127.0.0.1/a.wav', 'https://evil.test/a.wav',
                    'https://oss-test.aliyuncs.com.evil.test/a.wav',
                    'https://user:pass@a.oss-test.aliyuncs.com/a.wav'):
            with self.subTest(url=url):
                opener = self.opener(url)
                with patch.object(cloud, 'build_opener', return_value=opener):
                    with self.assertRaises(ValueError):
                        cloud.synthesize('예제', 'girl', 35)
                self.assertEqual(opener.open.call_count, 1)

    def test_does_not_follow_redirects(self):
        self.assertIsNone(cloud.NoRedirect().redirect_request(None, None, 302, '', {}, 'http://127.0.0.1'))

    def test_runtime_and_configuration_health_do_not_claim_verified_access(self):
        self.assertEqual(speech_runtime()[1], 'qwen-api')
        self.assertEqual(health._tts_check()['detail'], 'configured_not_verified')
        with patch.dict(os.environ, {'DASHSCOPE_API_KEY': ''}):
            self.assertEqual(health._tts_check()['detail'], 'missing_api_key')

    def test_cache_reuses_speech_and_invalidates_for_voice_change(self):
        with patch.object(server_speech, '_cache', SpeechCache()), \
                patch.object(server_speech, 'synthesize_qwen', return_value=wav_bytes()) as synth:
            for _ in range(2):
                self.assertEqual(server_speech.synthesize_speech('예제', .9, account_id='one'), wav_bytes())
            self.assertEqual(synth.call_count, 1)
            with patch.dict(os.environ, {'QWEN_API_GIRL_VOICE': 'Serena'}):
                server_speech.synthesize_speech('예제', .9, account_id='one')
            self.assertEqual(synth.call_count, 2)
            server_speech.synthesize_speech('예제', .9, account_id='two')
            self.assertEqual(synth.call_count, 3)

    def test_invalid_cloud_audio_is_rejected_without_local_fallback(self):
        with patch.object(server_speech, 'synthesize_qwen', return_value=b'not a wav'), \
                patch.object(server_speech, 'urlopen') as local:
            with self.assertRaises(HTTPException) as error:
                server_speech.synthesize_speech('예제', .9)
            self.assertEqual(error.exception.status_code, 503)
            local.assert_not_called()


if __name__ == '__main__':
    unittest.main()
