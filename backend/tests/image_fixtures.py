"""Generated synthetic images only; no personal photos or fixture binaries."""
from io import BytesIO
import struct

from PIL import ExifTags, Image
from PIL.PngImagePlugin import PngInfo
from PIL.TiffImagePlugin import IFDRational


FORMATS = {'JPEG': 'image/jpeg', 'PNG': 'image/png', 'WEBP': 'image/webp'}
PRIVATE = b'SYNTHETIC_PRIVATE_CAMERA_OWNER'
ICC = b'SYNTHETIC_PRIVATE_ICC_PROFILE'
XMP = b'<x:xmpmeta xmlns:x="adobe:ns:meta/">SYNTHETIC_PRIVATE_LOCATION</x:xmpmeta>'


def metadata_image(format='PNG', *, orientation=6):
    image = Image.new('RGB', (160, 128), 'red')
    image.paste('blue', (80, 0, 160, 128))
    exif = Image.Exif()
    exif[ExifTags.Base.Make] = PRIVATE.decode()
    exif[ExifTags.Base.Model] = 'SYNTHETIC_PRIVATE_DEVICE'
    exif[ExifTags.Base.DateTime] = '2026:10:18 01:02:03'
    exif[ExifTags.Base.Orientation] = orientation
    exif[ExifTags.IFD.GPSInfo] = {1: 'N', 2: tuple(IFDRational(n) for n in (1, 2, 3)),
                                3: 'E', 4: tuple(IFDRational(n) for n in (4, 5, 6))}
    options = {'exif': exif, 'icc_profile': ICC}
    if format == 'PNG':
        text = PngInfo()
        text.add_text('Author', PRIVATE.decode())
        text.add_itxt('XML:com.adobe.xmp', XMP.decode())
        options['pnginfo'] = text
    elif format == 'WEBP':
        options.update(xmp=XMP, lossless=True)
    elif format == 'JPEG':
        options['comment'] = PRIVATE
    output = BytesIO()
    image.save(output, format=format, **options)
    return output.getvalue()


def webp_chunks(data):
    """Inspect RIFF independently of Pillow metadata decoding."""
    if data[:4] != b'RIFF' or data[8:12] != b'WEBP' or struct.unpack_from('<I', data, 4)[0] + 8 != len(data):
        raise AssertionError('Invalid WebP container')
    chunks = []
    offset = 12
    while offset < len(data):
        if offset + 8 > len(data):
            raise AssertionError('Truncated WebP chunk')
        length = struct.unpack_from('<I', data, offset + 4)[0]
        chunks.append(data[offset:offset + 4])
        offset += 8 + length + (length % 2)
    if offset != len(data):
        raise AssertionError('Invalid WebP chunk length')
    return chunks


def assert_clean_webp(test, data):
    test.assertFalse({b'EXIF', b'XMP ', b'ICCP', b'ANIM', b'ANMF'} & set(webp_chunks(data)))
    with Image.open(BytesIO(data)) as image:
        image.load()
        test.assertEqual(image.format, 'WEBP')
        test.assertEqual(len(image.getexif()), 0)
        test.assertFalse({'exif', 'xmp', 'icc_profile', 'comment', 'Author', 'XML:com.adobe.xmp'} & image.info.keys())
        test.assertEqual(getattr(image, 'n_frames', 1), 1)
    for value in (PRIVATE, ICC, b'SYNTHETIC_PRIVATE_LOCATION', b'SYNTHETIC_PRIVATE_DEVICE'):
        test.assertNotIn(value, data)
