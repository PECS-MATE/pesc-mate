"""Isolated, timeout-bounded CPU inference with NO model download fallback."""
import os
from pathlib import Path
import sys


def main():
    import onnxruntime as ort
    from PIL import Image
    from rembg.sessions.u2netp import U2netpSession

    model = Path(os.environ['REMBG_MODEL_PATH']).resolve(strict=True)

    class LocalSession(U2netpSession):
        @classmethod
        def download_models(cls, *args, **kwargs):
            # Replace the library's download entry point; never fetch weights.
            return str(model)

    options = ort.SessionOptions()
    options.intra_op_num_threads = options.inter_op_num_threads = 1
    session = LocalSession('u2netp', options, providers=['CPUExecutionProvider'])
    with Image.open(sys.argv[1]) as image:
        rgba = image.convert('RGBA')
        mask = session.predict(rgba)[0]
        from PIL import ImageChops
        rgba.putalpha(ImageChops.multiply(rgba.getchannel('A'), mask))
        rgba.save(sys.argv[2], 'PNG')


if __name__ == '__main__':
    main()
