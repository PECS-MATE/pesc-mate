"""Explicit local presentation preparation; never invoked by login/startup."""
import argparse
from datetime import datetime, timezone
import hmac
from pathlib import Path
from uuid import uuid4

from bson import json_util

from app.services.authentication import _password_hash
from app.services.database import database
from app.services.schema_versions import SCHEMA_VERSION


def prepare_presentation_accounts(db, password, backup_dir):
    if not isinstance(password, str) or not 1 <= len(password) <= 128:
        raise ValueError('비밀번호 길이를 확인해 주세요.')
    second = db.users.find_one({'$or': [{'_id': 'demo2'}, {'username': 'demo2'}]})
    if second and (second['_id'] != 'demo2' or second.get('username') != 'demo2' or second.get('role') != 'user'):
        raise ValueError('demo2가 다른 계정에 사용 중입니다. 기존 계정은 변경하지 않았습니다.')
    credentials = list(db.users.find({}, {'_id': 1, 'password_salt': 1, 'password_hash': 1}))
    # Validate every existing credential before the first write.
    for row in credentials:
        _password_hash(password, row['password_salt'])
        if not isinstance(row.get('password_hash'), str):
            raise ValueError('기존 비밀번호 형식을 확인해 주세요.')
    now = datetime.now(timezone.utc)
    directory = Path(backup_dir)
    directory.mkdir(parents=True, exist_ok=True)
    backup = directory / f'presentation-credentials-{now:%Y%m%dT%H%M%SZ}-{uuid4().hex}.json'
    with backup.open('x', encoding='utf-8') as output:
        output.write(json_util.dumps({'database': db.name, 'created_at': now, 'credentials': credentials}))
    if not second:
        salt, hashed = _password_hash(password)
        db.users.insert_one({'_id': 'demo2', 'username': 'demo2', 'name': '시연 사용자 2',
                             'role': 'user', 'schema_version': SCHEMA_VERSION,
                             'default_output_mode': 'selection', 'password_salt': salt,
                             'password_hash': hashed, 'created_at': now})
    updated = unchanged = 0
    for row in credentials:
        _, candidate = _password_hash(password, row['password_salt'])
        if hmac.compare_digest(candidate, row['password_hash']):
            unchanged += 1
            continue
        salt, hashed = _password_hash(password)
        result = db.users.update_one({'_id': row['_id'], 'password_salt': row['password_salt'],
                                      'password_hash': row['password_hash']},
                                     {'$set': {'password_salt': salt, 'password_hash': hashed}})
        if result.matched_count != 1:
            raise RuntimeError('진행 중 계정이 변경됐습니다. 백업을 유지하고 적용 상태를 확인해 주세요.')
        updated += 1
    verified = 0
    for row in db.users.find({}, {'password_salt': 1, 'password_hash': 1}):
        _, candidate = _password_hash(password, row['password_salt'])
        if not hmac.compare_digest(candidate, row['password_hash']):
            raise RuntimeError('일부 계정의 비밀번호 적용을 확인하지 못했습니다.')
        verified += 1
    return {'created_demo2': second is None, 'updated': updated, 'unchanged': unchanged,
            'verified': verified, 'backup': str(backup)}


def main():
    parser = argparse.ArgumentParser(description='로컬 시연 계정 비밀번호 통일 및 두 번째 아동 계정 준비')
    parser.add_argument('--password', required=True)
    parser.add_argument('--backup-dir', required=True)
    args = parser.parse_args()
    result = prepare_presentation_accounts(database(), args.password, args.backup_dir)
    print(json_util.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
