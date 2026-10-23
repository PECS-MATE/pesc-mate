from io import BytesIO
import json
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from PIL import Image

from app.services import card_submissions as cards
from app.services.image_edits import DEFAULT_EDITS, validate_edits
from tests.image_fixtures import assert_clean_webp, metadata_image


def striped_image():
    image = Image.new('RGBA', (384, 128), (200, 0, 0, 64))
    image.paste((0, 100, 0, 64), (128, 0, 256, 128))
    image.paste((0, 0, 200, 64), (256, 0, 384, 128))
    output = BytesIO()
    image.save(output, format='PNG')
    return output.getvalue()


class ImageEditTests(unittest.TestCase):
    def test_defaults_are_opt_in_and_do_not_change_existing_normalization(self):
        original = metadata_image()
        expected = cards._normalize_image(original, 'image/png')
        for edits in (None, {}, DEFAULT_EDITS, '{}'):
            self.assertEqual(cards._normalize_image(original, 'image/png', image_edits=edits), expected)
        self.assertEqual(validate_edits('{"rotation":90}'), {**DEFAULT_EDITS, 'rotation': 90})

    def test_invalid_edit_types_ranges_and_extra_fields_stop_before_image_decode(self):
        invalid = ['not-json', 'null', '[]', '{' + ' ' * 256 + '}', {'crop': []}, {'crop': 'detect'},
                   {'rotation': True}, {'rotation': 45}, {'rotation': 360}, {'rotation': '90'},
                   {'brightness': False}, {'brightness': 100.0}, {'brightness': 49}, {'brightness': 151},
                   {'brightness': float('nan')}, {'url': 'https://private.invalid/image'}]
        with patch.object(cards.Image, 'open') as opened:
            for edits in invalid:
                with self.subTest(edits=edits), self.assertRaises(HTTPException) as caught:
                    cards._normalize_image(b'synthetic', 'image/png', image_edits=edits)
                self.assertEqual(caught.exception.status_code, 422)
            opened.assert_not_called()

    def test_clockwise_rotation_keeps_whole_frame_and_alpha(self):
        for rotation in (90, 180, 270):
            with self.subTest(rotation=rotation):
                content, _ = cards._normalize_image(striped_image(), 'image/png', image_edits={'rotation': rotation})
                assert_clean_webp(self, content)
                with Image.open(BytesIO(content)) as image:
                    self.assertEqual(image.size, (128, 384) if rotation != 180 else (384, 128))
                    self.assertEqual(image.getpixel((0, 0))[3], 64)
                    if rotation == 90:
                        top, bottom = image.getpixel((64, 64)), image.getpixel((64, 320))
                        self.assertGreater(top[0], top[2] + 100)
                        self.assertGreater(bottom[2], bottom[0] + 100)

    def test_center_crop_after_orientation_rotation_and_brightness_keeps_original_bytes_unchanged(self):
        original = striped_image()
        content, _ = cards._normalize_image(original, 'image/png', image_edits={
            'crop': 'square', 'rotation': 90, 'brightness': 150})
        assert_clean_webp(self, content)
        with Image.open(BytesIO(content)) as image:
            self.assertEqual(image.size, (128, 128))
            for point in ((10, 10), (64, 64), (110, 110)):
                red, green, blue, alpha = image.getpixel(point)
                self.assertAlmostEqual(green, 150, delta=5)
                self.assertLess(red, 5); self.assertLess(blue, 5); self.assertEqual(alpha, 64)
        self.assertEqual(cards._preserve_original(original, 'image/png', content)['data'], original)

    def test_exif_orientation_still_precedes_user_rotation_and_metadata_removal(self):
        content, _ = cards._normalize_image(metadata_image(), 'image/png', image_edits={'rotation': 90})
        assert_clean_webp(self, content)
        with Image.open(BytesIO(content)) as image:
            self.assertEqual(image.size, (160, 128))

    def test_brightness_limits_preserve_partial_alpha_without_changing_upload_limits(self):
        output = BytesIO()
        Image.new('RGBA', (128, 128), (40, 80, 120, 64)).save(output, format='PNG')
        for brightness in (50, 150):
            content, _ = cards._normalize_image(output.getvalue(), 'image/png', image_edits={'brightness': brightness})
            with Image.open(BytesIO(content)) as image:
                pixel = image.getpixel((64, 64))
                for actual, base in zip(pixel[:3], (40, 80, 120)):
                    self.assertAlmostEqual(actual, base * brightness / 100, delta=5)
                self.assertEqual(pixel[3], 64)
        small = BytesIO()
        Image.new('RGB', (127, 128)).save(small, format='PNG')
        with self.assertRaises(HTTPException):
            cards._normalize_image(small.getvalue(), 'image/png', image_edits=json.dumps({'crop': 'square'}))
