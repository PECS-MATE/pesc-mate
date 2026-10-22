from io import BytesIO
from hashlib import sha256
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from PIL import ExifTags, Image

from app.services import card_submissions as cards
from app.services.profiles import save_profile
from tests.image_fixtures import FORMATS, ICC, PRIVATE, assert_clean_webp, metadata_image, webp_chunks


class ImageNormalizationTests(unittest.TestCase):
    def test_archive_preserves_exact_validated_bytes_and_integrity_metadata_not_filename(self):
        for format, mime in FORMATS.items():
            original = metadata_image(format)
            display, _ = cards._normalize_image(original, mime)
            archived = cards._preserve_original(original, mime, display)
            self.assertEqual(archived, {'data': original, 'content_type': mime,
                'size_bytes': len(original), 'sha256': sha256(original).hexdigest()})
            assert_clean_webp(self, display)

    def test_archive_budget_is_checked_before_profile_storage(self):
        with patch.object(cards, 'MAX_STORED_IMAGE_BYTES', 1), patch('app.services.profiles.database') as db, \
                patch('app.services.profiles.check_image_safety', return_value={'status': 'passed'}):
            with self.assertRaises(HTTPException) as caught:
                save_profile('child', image_data=metadata_image(), content_type='image/png')
            self.assertEqual(caught.exception.status_code, 422)
            db.assert_not_called()

    def rejected(self, data, mime):
        with self.assertRaises(HTTPException) as caught:
            cards._normalize_image(data, mime)
        self.assertEqual(caught.exception.status_code, 422)

    def test_real_exif_gps_device_text_icc_and_xmp_are_removed_for_all_formats(self):
        for format, mime in FORMATS.items():
            with self.subTest(format=format):
                original = metadata_image(format)
                with Image.open(BytesIO(original)) as source:
                    self.assertEqual(source.getexif()[ExifTags.Base.Make], PRIVATE.decode())
                    self.assertTrue(source.getexif().get_ifd(ExifTags.IFD.GPSInfo))
                    self.assertEqual(source.info['icc_profile'], ICC)
                    if format == 'PNG':
                        self.assertIn('Author', source.info)
                        self.assertIn('XML:com.adobe.xmp', source.info)
                if format == 'WEBP':
                    self.assertTrue({b'EXIF', b'XMP ', b'ICCP'}.issubset(webp_chunks(original)))
                result, content_type = cards._normalize_image(original, mime)
                self.assertEqual(content_type, 'image/webp')
                assert_clean_webp(self, result)

    def test_orientation_is_applied_to_pixels_before_removing_exif(self):
        for format, mime in FORMATS.items():
            with self.subTest(format=format):
                result, _ = cards._normalize_image(metadata_image(format), mime)
                with Image.open(BytesIO(result)) as image:
                    self.assertEqual(image.size, (128, 160))
                    top, bottom = image.convert('RGB').getpixel((64, 30)), image.convert('RGB').getpixel((64, 130))
                    self.assertGreater(top[0], top[2] + 100)
                    self.assertGreater(bottom[2], bottom[0] + 100)

    def test_palette_and_rgb_key_transparency_are_preserved(self):
        for mode in ('P', 'RGB'):
            with self.subTest(mode=mode):
                source = Image.new(mode, (128, 128))
                if mode == 'P':
                    source.putpalette([255, 0, 0, 0, 0, 255] + [0] * 762)
                    source.paste(1, (64, 0, 128, 128))
                    transparent = 0
                else:
                    source.paste('red', (0, 0, 64, 128))
                    source.paste('blue', (64, 0, 128, 128))
                    transparent = (255, 0, 0)
                output = BytesIO()
                source.save(output, format='PNG', transparency=transparent)
                result, _ = cards._normalize_image(output.getvalue(), 'image/png')
                assert_clean_webp(self, result)
                with Image.open(BytesIO(result)) as image:
                    self.assertEqual(image.convert('RGBA').getpixel((20, 20))[3], 0)
                    self.assertEqual(image.convert('RGBA').getpixel((100, 20))[3], 255)

    def test_every_mime_mismatch_is_rejected(self):
        for format, actual in FORMATS.items():
            original = metadata_image(format)
            for declared in FORMATS.values():
                if actual != declared:
                    with self.subTest(format=format, declared=declared):
                        self.rejected(original, declared)

    def test_decoder_disagreement_is_rejected_even_with_matching_header_and_mime(self):
        original = metadata_image()
        with patch.object(cards.Image, 'open') as opened:
            probe = opened.return_value.__enter__.return_value
            probe.format, probe.size = 'JPEG', (160, 128)
            self.rejected(original, 'image/png')
            self.assertEqual(opened.call_count, 1)
            probe.verify.assert_called_once()

    def test_encoder_receives_no_metadata_even_if_defaults_change(self):
        original = metadata_image()
        real_save = Image.Image.save

        def save(image, output, **options):
            self.assertEqual(image.info, {})
            self.assertEqual(len(image.getexif()), 0)
            for name in ('exif', 'icc_profile', 'xmp'):
                self.assertEqual(options[name], b'')
            return real_save(image, output, **options)

        with patch.object(Image.Image, 'save', autospec=True, side_effect=save) as encoder:
            cards._normalize_image(original, 'image/png')
        encoder.assert_called_once()

    def test_partial_alpha_is_preserved(self):
        output = BytesIO()
        Image.new('RGBA', (128, 128), (255, 0, 0, 64)).save(output, format='PNG')
        result, _ = cards._normalize_image(output.getvalue(), 'image/png')
        assert_clean_webp(self, result)
        with Image.open(BytesIO(result)) as image:
            self.assertEqual(image.convert('RGBA').getpixel((64, 64))[3], 64)

    def test_header_alone_truncated_payload_and_other_formats_are_rejected(self):
        for header, mime in ((b'\xff\xd8\xff', 'image/jpeg'), (b'\x89PNG\r\n\x1a\n', 'image/png'),
                             (b'RIFF\x04\x00\x00\x00WEBP', 'image/webp')):
            self.rejected(header + b'not-valid-image-data', mime)
        for format, mime in FORMATS.items():
            data = metadata_image(format)
            self.rejected(data[:len(data) // 2], mime)
        self.rejected(metadata_image('JPEG')[:-2], 'image/jpeg')
        gif = BytesIO()
        Image.new('RGB', (128, 128)).save(gif, format='GIF')
        for mime in FORMATS.values():
            self.rejected(gif.getvalue(), mime)
            self.rejected(b'<svg><script>synthetic</script></svg>', mime)

    def test_unknown_mime_and_size_limit_stop_before_decoder(self):
        with patch.object(cards.Image, 'open') as opened:
            for mime in ('application/octet-stream', 'image/svg+xml', 'image/jpg', None):
                self.rejected(b'image', mime)
            self.rejected(b'', 'image/png')
            self.rejected(b'x' * (cards.MAX_IMAGE_BYTES + 1), 'image/png')
        opened.assert_not_called()

    def test_dimension_and_pixel_limits_are_enforced(self):
        for size in ((127, 128), (128, 127), (4097, 128)):
            output = BytesIO()
            Image.new('RGB', size).save(output, format='PNG')
            self.rejected(output.getvalue(), 'image/png')
        with patch.object(cards, 'MAX_IMAGE_PIXELS', 20000):
            self.rejected(metadata_image(), 'image/png')

    def test_decompression_warning_and_error_are_rejected_without_large_allocation(self):
        for limit in (15000, 5000):
            with patch.object(Image, 'MAX_IMAGE_PIXELS', limit):
                self.rejected(metadata_image(), 'image/png')

    def test_trailing_data_is_not_copied_into_reencoded_image(self):
        for format in ('JPEG', 'PNG'):
            result, _ = cards._normalize_image(metadata_image(format) + b'SYNTHETIC_TRAILING_PAYLOAD', FORMATS[format])
            assert_clean_webp(self, result)
            self.assertNotIn(b'SYNTHETIC_TRAILING_PAYLOAD', result)

    def test_animated_png_and_webp_are_flattened_to_first_frame(self):
        for format in ('PNG', 'WEBP'):
            output = BytesIO()
            Image.new('RGBA', (128, 128), 'red').save(output, format=format, save_all=True,
                append_images=[Image.new('RGBA', (128, 128), 'blue')], duration=100, loop=0)
            with Image.open(BytesIO(output.getvalue())) as source:
                self.assertEqual(source.n_frames, 2)
            result, _ = cards._normalize_image(output.getvalue(), FORMATS[format])
            assert_clean_webp(self, result)
            with Image.open(BytesIO(result)) as image:
                pixel = image.convert('RGB').getpixel((64, 64))
                self.assertGreater(pixel[0], pixel[2] + 100)

    @patch('app.services.profiles.database')
    @patch('app.services.profiles.check_image_safety')
    def test_profile_mismatch_never_reaches_safety_provider_or_database(self, safety, database):
        with self.assertRaises(HTTPException) as caught:
            save_profile('child', image_data=metadata_image('JPEG'), content_type='image/png')
        self.assertEqual(caught.exception.status_code, 422)
        safety.assert_not_called()
        database.assert_not_called()


if __name__ == '__main__':
    unittest.main()
