import json
import os
import unittest
from unittest.mock import MagicMock, patch

from app.services.image_safety import check_image_safety


class ImageSafetyTests(unittest.TestCase):
    @patch.dict(os.environ, {}, clear=False)
    def test_missing_provider_requires_manual_review(self):
        os.environ.pop('IMAGE_SAFETY_API_URL', None)
        result = check_image_safety(b'image', 'image/webp')
        self.assertEqual(result['status'], 'manual_review')
        self.assertEqual(result['provider'], 'administrator')

    @patch('app.services.image_safety.urlopen')
    @patch.dict(os.environ, {'IMAGE_SAFETY_API_URL': 'https://safety.example/check'}, clear=False)
    def test_provider_can_block_image(self, mocked_urlopen):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({
            'safe': False, 'provider': 'test-provider', 'reasons': ['unsafe'],
        }).encode()
        mocked_urlopen.return_value = response
        result = check_image_safety(b'image', 'image/webp')
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(result['reasons'], ['unsafe'])


if __name__ == '__main__':
    unittest.main()
