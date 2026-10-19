"""Per-request password verification; never mint or cache an elevated session."""
import hmac

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.account_access import account_access_allowed
from app.services.database import database as _database


def verify_account_password(account, password, client_ip, prefix):
    from app.services.authentication import _password_hash
    from app.services.login_throttle import clear_login_failures, ensure_login_allowed, record_login_failure
    key = prefix + account['username']
    ensure_login_allowed(key, client_ip)
    _, candidate = _password_hash(password, account['password_salt'])
    if not hmac.compare_digest(candidate, account['password_hash']):
        record_login_failure(key, client_ip)
        raise HTTPException(403, '본인 비밀번호를 확인해 주세요.')
    clear_login_failures(key, client_ip)


def reauthenticate_content_operator(actor, password, client_ip=None):
    from app.services.account_permissions import permission_revision
    from app.services.authentication import require_account_permission
    require_account_permission(actor, 'content_manage')
    try:
        account = _database().users.find_one({'_id': actor['id']})
        if (not account or not account_access_allowed(account)
                or permission_revision(account) != actor.get('permission_revision', 0)):
            raise HTTPException(401, '계정 접근 또는 권한이 변경되었습니다. 다시 로그인해 주세요.')
        require_account_permission(account, 'content_manage')
        verify_account_password(account, password, client_ip, 'content-operation:')
    except PyMongoError as exc:
        raise HTTPException(503, '재인증을 확인하지 못했습니다. 작업은 실행하지 않았습니다.') from exc
