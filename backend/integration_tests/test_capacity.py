import pytest
from fastapi import HTTPException
from app.services.image_storage import check_capacity, usage

pytestmark = pytest.mark.integration


def test_real_binary_accounting_and_capacity_error_contract(mongo_db, monkeypatch):
    mongo_db.users.insert_one({'_id': 'one', 'profile': {'image_data': b'a' * 100}})
    mongo_db.card_submissions.insert_one({'_id': 'card', 'owner_id': 'one',
        'image': {'data': b'b' * 200}, 'original_image': {'data': b'c' * 300}})
    mongo_db.card_submissions.insert_one({'_id': 'other', 'owner_id': 'two', 'thumbnail': {'data': b'd' * 50}})
    mongo_db.a4_projects.insert_one({'_id': 'project', 'owner_id': 'one', 'storage_bytes': 400})
    assert usage(mongo_db, 'one') == {'user_bytes': 1000, 'total_bytes': 1050}
    monkeypatch.setenv('IMAGE_USER_LIMIT_MIB', '1')
    monkeypatch.setenv('IMAGE_TOTAL_LIMIT_MIB', '2')
    check_capacity(mongo_db, 'one', 1)
    with pytest.raises(HTTPException) as error:
        check_capacity(mongo_db, 'one', 1024 * 1024)
    assert error.value.status_code == 413
    assert '이미지 저장 한도' in error.value.detail
