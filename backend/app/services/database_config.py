"""Separate local URI connections from explicitly required file-based authentication."""
import os
from pathlib import Path
import re


class DatabaseConfigurationError(ValueError):
    """Messages must never include secret values, URIs, or file contents."""


def _invalid():
    return DatabaseConfigurationError('MongoDB authentication configuration is missing or invalid.')


def _secret(path):
    try:
        if not path or not Path(path).is_absolute() or not Path(path).is_file():
            raise _invalid()
        with open(path, 'rb') as source:
            data = source.read(1025)
        if len(data) > 1024:
            raise _invalid()
        return data.decode('ascii').rstrip('\r\n')
    except (OSError, UnicodeError):
        raise _invalid() from None


def connection_options():
    required = os.environ.get('MONGODB_REQUIRE_AUTH', 'false').strip().lower()
    if required not in {'true', 'false'}:
        raise _invalid()
    file_mode = required == 'true' or any(key in os.environ for key in (
        'MONGODB_USERNAME_FILE', 'MONGODB_PASSWORD_FILE'))
    if not file_mode:
        return {'host': os.environ.get('MONGODB_URI', 'mongodb://127.0.0.1:27017')}
    # Never silently choose one credential source or fall back to unauthenticated localhost.
    if os.environ.get('MONGODB_URI'):
        raise _invalid()
    name = os.environ.get('MONGODB_DATABASE', '')
    host = os.environ.get('MONGODB_HOST', '')
    port = os.environ.get('MONGODB_PORT', '27017')
    auth_source = os.environ.get('MONGODB_AUTH_SOURCE', name)
    if (not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_-]{0,62}', name)
            or name.lower() in {'admin', 'config', 'local'} or auth_source != name
            or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,252}', host)
            or not re.fullmatch(r'[0-9]{1,5}', port) or not 1 <= int(port) <= 65535):
        raise _invalid()
    username = _secret(os.environ.get('MONGODB_USERNAME_FILE'))
    password = _secret(os.environ.get('MONGODB_PASSWORD_FILE'))
    if (not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{2,63}', username)
            or username.lower() in {'root', 'admin'} or not re.fullmatch(r'[!-~]{32,256}', password)):
        raise _invalid()
    return {'host': host, 'port': int(port), 'username': username, 'password': password,
            'authSource': name, 'authMechanism': 'SCRAM-SHA-256'}
