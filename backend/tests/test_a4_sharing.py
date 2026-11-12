import base64
from uuid import UUID

import pytest
from fastapi import HTTPException
from app.services import a4_projects


def test_save_load_share_approval_withdrawal_and_version_conflict(db, png_bytes, monkeypatch):
    # mongomock cannot evaluate $binarySize. Real quota accounting is tested in integration_tests.
    monkeypatch.setattr(a4_projects.storage, 'usage', lambda *args: {'total_bytes': 0, 'user_bytes': 0})
    project = a4_projects.Project.model_validate({
        'format': 'pecsmate-a4-share', 'version': 1, 'cards': [
            {'id': 'c1', 'label': 'synthetic', 'image': 'data:image/png;base64,' + base64.b64encode(png_bytes).decode()}],
        'layout': {'settings': {'orientation': 'portrait', 'columns': 1, 'rows': 1,
            'margin': 10, 'gap': 3, 'size': 40, 'labels': False},
            'slots': [{'rowId': 'c1', 'label': 'hidden', 'zoom': 1, 'fontSize': 12, 'fit': 'contain'}]},
    })
    body = a4_projects.SaveRequest(request_id=UUID(int=10), title='synthetic', project=project,
        publish=True, rights_confirmed=True, privacy_confirmed=True)
    owner = {'id': 'guardian-one', 'role': 'caregiver'}
    other = {'id': 'guardian-two', 'role': 'caregiver'}
    moderator = {'id': 'moderator', 'role': 'support_staff', 'account_permissions': ['content_manage']}
    db.users.insert_one({'_id': owner['id']})
    first = a4_projects.save_project(body, owner)
    assert first['status'] == 'pending'
    assert a4_projects.save_project(body, owner)['id'] == first['id']
    assert a4_projects.project_detail(first['id'], owner)['project']['cards'][0]['label'] == ''
    with pytest.raises(HTTPException) as error:
        a4_projects.project_detail(first['id'], other)
    assert error.value.status_code == 404
    approved = a4_projects.review_project(first['id'], 1, 'approve', '', moderator)
    assert approved['version'] == 2 and approved['status'] == 'approved'
    assert a4_projects.project_detail(first['id'], other)['status'] == 'approved'
    with pytest.raises(HTTPException) as error:
        a4_projects.withdraw_project(first['id'], 1, owner)
    assert error.value.status_code == 409
    assert a4_projects.withdraw_project(first['id'], 2, owner)['status'] == 'withdrawn'
    with pytest.raises(HTTPException) as error:
        a4_projects.project_detail(first['id'], other)
    assert error.value.status_code == 404
