"""Hermetic publication/resume tests; no Docker, model or user data is accessed."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave

spec = importlib.util.spec_from_file_location('generator', Path(__file__).with_name('generate-card-speech.py'))
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


def audio():
    output = io.BytesIO()
    with wave.open(output, 'wb') as clip:
        clip.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
        clip.writeframes(b'\x01\x00' * 4800)
    return output.getvalue()


class GenerationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.patches = contextlib.ExitStack()
        self.patches.enter_context(patch.object(generator, 'ROOT', self.root))
        self.patches.enter_context(patch.object(generator, 'OUTPUT', self.root / 'public'))
        self.patches.enter_context(patch.object(generator, 'STAGING', self.root / 'staging'))
        self.patches.enter_context(patch.object(generator, 'catalog', return_value=[
            {'id': 'water', 'text': '물', 'file': 'water.wav'},
            {'id': 'help', 'text': '도와주세요', 'file': 'help.wav'}]))
        self.patches.enter_context(patch.object(sys, 'argv', ['generate-card-speech.py']))
        self.patches.enter_context(contextlib.redirect_stdout(io.StringIO()))
        self.requests = []
        self.voice_version = 'test-reference'

    def tearDown(self):
        self.patches.close()
        self.temporary.cleanup()

    def transport(self, command, **options):
        payload = options.get('input')
        if not payload:
            return subprocess.CompletedProcess(command, 0, stdout=json.dumps({
                'provider': 'qwen3-tts', 'voices': ['girl', 'boy'], 'voice_version': self.voice_version}).encode())
        request = json.loads(payload)
        self.assertEqual(request['rate'], 1)
        self.requests.append(request)
        return subprocess.CompletedProcess(command, 0, stdout=audio())

    def test_complete_publication_and_reuse(self):
        with patch.object(generator.subprocess, 'run', side_effect=self.transport):
            generator.main()
            self.assertEqual(len(self.requests), 4)
            manifest = json.loads((self.root / 'public/manifest.json').read_text(encoding='utf-8'))
            self.assertEqual(len(manifest['entries']), 2)
            for voice in ['girl', 'boy']:
                self.assertTrue(generator.valid_audio((self.root / f'public/{voice}/help.wav').read_bytes()))
            self.requests.clear()
            generator.main()
            self.assertEqual(self.requests, [])

    def test_failure_never_publishes_partial_pack_and_resume_reuses_valid_clips(self):
        def failing(command, **options):
            if options.get('input') and self.requests:
                raise subprocess.CalledProcessError(1, command)
            return self.transport(command, **options)
        with patch.object(generator.subprocess, 'run', side_effect=failing):
            with self.assertRaises(subprocess.CalledProcessError):
                generator.main()
        self.assertFalse((self.root / 'public/manifest.json').exists())
        self.assertTrue((self.root / 'staging/girl/water.wav').exists())
        self.requests.clear()
        with patch.object(generator.subprocess, 'run', side_effect=self.transport):
            generator.main()
        self.assertEqual(len(self.requests), 3)
        self.assertTrue((self.root / 'public/manifest.json').exists())

    def test_interrupted_reference_change_never_reuses_old_voice_clips(self):
        with patch.object(generator.subprocess, 'run', side_effect=self.transport):
            generator.main()
        self.voice_version = 'new-reference'
        self.requests.clear()

        def failing(command, **options):
            if options.get('input') and self.requests:
                raise subprocess.CalledProcessError(1, command)
            return self.transport(command, **options)

        with patch.object(generator.subprocess, 'run', side_effect=failing):
            with self.assertRaises(subprocess.CalledProcessError):
                generator.main()
        self.requests.clear()
        with patch.object(generator.subprocess, 'run', side_effect=self.transport):
            generator.main()
        self.assertEqual(len(self.requests), 3)
        manifest = json.loads((self.root / 'public/manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['voice_version'], 'new-reference')


if __name__ == '__main__':
    unittest.main()
