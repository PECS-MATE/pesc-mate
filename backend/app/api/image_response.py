"""Conditional image responses after the caller has authorized current access."""
from hashlib import sha256
from fastapi import Response


def _image_response(request, content, content_type):
    etag = '"' + sha256(content).hexdigest() + '"'
    headers = {'Cache-Control': 'private, no-cache', 'ETag': etag, 'Vary': 'Authorization'}
    # Authorization and current document lookup have already happened, including on 304.
    if request.headers.get('if-none-match') == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=content, media_type=content_type, headers=headers)
