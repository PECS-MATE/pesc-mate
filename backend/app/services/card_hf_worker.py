"""Remote inference only. No local model weights, remote code or paid retries."""
from io import BytesIO
import os
from pathlib import Path
import sys
import warnings


def main():
    from huggingface_hub import InferenceClient
    from PIL import Image

    # A decompression warning must not become an unbounded image decode.
    Image.MAX_IMAGE_PIXELS = 16_000_000
    warnings.simplefilter('error', Image.DecompressionBombWarning)
    output, model, provider = sys.argv[1:]
    client = InferenceClient(provider=provider, api_key=os.environ['HF_TOKEN'].strip(), timeout=60)
    try:
        parameters = {'num_inference_steps': 4} if model == 'black-forest-labs/FLUX.1-schnell' else {}
        image = client.text_to_image(sys.stdin.buffer.read(8192).decode('utf-8'),
                                     model=model, width=1024, height=1024, **parameters)
        if min(image.size) < 128 or max(image.size) > 4096:
            raise ValueError('invalid dimensions')
        image.load()
        image = image.convert('RGBA' if 'A' in image.getbands() else 'RGB')
        image.info.clear()
        result = BytesIO()
        image.save(result, 'PNG')
        if result.tell() > 5 * 1024 * 1024:
            raise ValueError('oversized image')
        Path(output).write_bytes(result.getvalue())
    except Exception as exc:
        # Do not print exception bodies: vendor errors can contain request data.
        status = getattr(getattr(exc, 'response', None), 'status_code', None)
        return {401: 10, 403: 10, 402: 11, 429: 12, 400: 13, 404: 13, 422: 13}.get(status, 15)
    finally:
        client.close()
    return 0


if __name__ == '__main__':
    try:
        code = main()
    except Exception:
        code = 15
    sys.exit(code)
