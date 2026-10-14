import io
import json
import os
import unittest
from unittest.mock import patch

from app.services.model import generate_sentence, status
from app.services.sentence_policy import policy_versions, system_prompt


class ModelTests(unittest.TestCase):
    def test_disabled_model_uses_rule(self):
        with patch.dict(os.environ, {'OLLAMA_ENABLED': 'false'}):
            self.assertEqual(generate_sentence(['나'], '나'), ('나', 'rule'))

    @patch('app.services.model.urlopen')
    def test_ollama_response_is_used(self, mocked_urlopen):
        response = io.BytesIO(json.dumps({'response': '저는 물을 마시고 싶어요.'}).encode())
        mocked_urlopen.return_value = response
        with patch.dict(os.environ, {'OLLAMA_ENABLED': 'true'}):
            self.assertEqual(generate_sentence(['나', '물', '마시다'], '기본 문장'),
                             ('저는 물을 마시고 싶어요.', 'ollama'))
        request = mocked_urlopen.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(payload['system'], system_prompt())
        self.assertIn('카드에 없는 사람', payload['system'])
        self.assertIn('카드를 단순히 이어 붙이지 말고', payload['prompt'])
        self.assertIn('주어를 새로 추가하지 마세요', payload['prompt'])
        self.assertIn('그대로 출력하세요', payload['prompt'])
        self.assertIn('먹거나 마시는 게 싫어요.', payload['prompt'])

    @patch('app.services.model.urlopen')
    def test_multiple_outputs_or_unselected_subject_use_rule(self, mocked_urlopen):
        for generated in ('먹는 게 싫어요. / 마시는 게 싫어요.', '저는 먹는 게 싫어요.'):
            mocked_urlopen.return_value = io.BytesIO(json.dumps({'response': generated}).encode())
            with patch.dict(os.environ, {'OLLAMA_ENABLED': 'true'}):
                self.assertEqual(generate_sentence(['먹다'], '먹고 싶어요.'),
                                 ('먹고 싶어요.', 'rule'))

    def test_status_exposes_generation_policy_versions(self):
        model_status = status()
        self.assertEqual(model_status['policy_versions'], policy_versions())
        self.assertEqual(set(model_status['policy_versions']),
                         {'persona', 'output_rules', 'rule_engine', 'safety'})

    @patch('app.services.model.urlopen', side_effect=TimeoutError)
    def test_model_failure_uses_rule(self, _mocked_urlopen):
        with patch.dict(os.environ, {'OLLAMA_ENABLED': 'true'}):
            self.assertEqual(generate_sentence(['나'], '나'), ('나', 'rule'))


if __name__ == '__main__':
    unittest.main()
