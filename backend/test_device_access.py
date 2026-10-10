import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.services import device_access


class DeviceAccessLoggingTests(unittest.TestCase):
    def setUp(self):
        device_access._seen.clear()

    @patch('app.services.device_access.logger')
    def test_logs_masked_forwarded_device_information(self, mocked_logger):
        request = SimpleNamespace(
            headers={
                'x-forwarded-for': '172.30.1.81',
                'x-pesc-device': '12345678-abcd-4abc-8abc-1234567890ab',
                'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit Chrome/140.0 Mobile Safari/537.36',
            },
            client=SimpleNamespace(host='172.21.0.4'),
        )

        self.assertTrue(device_access.log_device_access(request, now=100))
        arguments = mocked_logger.info.call_args.args
        self.assertEqual(
            arguments[0],
            'DEVICE | CONNECT | device=%s | type=%s | browser=%s',
        )
        self.assertEqual(arguments[1:], ('12345678', 'mobile', 'Chrome'))

    @patch('app.services.device_access.logger')
    def test_suppresses_repeated_access_from_same_device(self, mocked_logger):
        request = SimpleNamespace(
            headers={
                'x-pesc-device': '87654321-abcd-4abc-8abc-1234567890ab',
                'user-agent': 'Mozilla/5.0 (iPad) Version/18.0 Mobile Safari/604.1',
            },
            client=SimpleNamespace(host='172.30.1.81'),
        )

        self.assertTrue(device_access.log_device_access(request, now=100))
        self.assertFalse(device_access.log_device_access(request, now=200))
        self.assertEqual(mocked_logger.info.call_count, 1)


if __name__ == '__main__':
    unittest.main()
