"""Shared MongoDB connection for the application process."""
from functools import lru_cache
import os

from pymongo import MongoClient
from app.services.database_config import connection_options

@lru_cache(maxsize=1)
def client():
    return MongoClient(
        **connection_options(),
        serverSelectionTimeoutMS=3000,
        appname='pesc-mate-backend',
    )


def database():
    return client()[os.environ.get('MONGODB_DATABASE', 'pesc_mate')]
