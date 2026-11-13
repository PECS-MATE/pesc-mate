from datetime import date, datetime, timedelta, timezone
from io import BytesIO
import base64
import hashlib
import json
from types import SimpleNamespace

from fastapi import HTTPException, Response
import pytest
from PIL import Image
from app.api import learning_program
from app.services import learning_program as program_service
from app.services import card_submissions, rfid, card_scan, authentication


def test_course_revision_conflict_preserves_first_save_and_audit(consented, monkeypatch):
    monkeypatch.setattr(program_service, 'authorize', lambda *a: None)
    monkeypatch.setattr(program_service, 'available_cards', lambda _: [])
    body = learning_program.ProgramChange(expected_revision=0, sets=[], daily_set_ids=[], starts_on=date(2026, 1, 1))
    user = {'id': 'guardian', 'role': 'caregiver'}
    response = Response()
    assert learning_program.save_program(body, response, 'one', user)['revision'] == 1
    with pytest.raises(HTTPException) as error:
        learning_program.save_program(body, Response(), 'one', user)
    assert error.value.status_code == 409
    assert consented.learning_settings.find_one({'_id': 'one'})['program_revision'] == 1
    assert consented.learning_audit_logs.count_documents({}) == 1
    assert response.headers['cache-control'] == 'no-store'


def test_personal_shared_card_visibility_and_image_access(db, png_bytes):
    for key, owner, visibility, status in [('own', 'one', 'private', 'pending'),
            ('other', 'two', 'private', 'approved'), ('shared', 'two', 'shared', 'approved'),
            ('draft', 'two', 'shared', 'draft')]:
        db.card_submissions.insert_one({'_id': key, 'owner_id': owner, 'visibility': visibility, 'status': status,
            'label': '합성', 'meaning': '합성 카드', 'category': '음식', 'created_at': datetime.now(timezone.utc),
            'image': {'data': png_bytes, 'content_type': 'image/png', 'filename': 'synthetic.png'}})
    assert {row['id'] for row in card_submissions.approved_cards_for('one')} == {'custom:own', 'custom:shared'}
    assert {row['id'] for row in card_submissions.approved_cards_for(None, shared_only=True)} == {'custom:shared'}
    user = {'id': 'one', 'role': 'user'}
    assert card_submissions.image_for('own', user)[0] == png_bytes
    assert card_submissions.image_for('shared', user)[0] == png_bytes
    for key in ('other', 'draft'):
        with pytest.raises(HTTPException) as error:
            card_submissions.image_for(key, user)
        assert error.value.status_code == 403


def test_wifi_authentication_and_twenty_second_staleness(consented, monkeypatch):
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    consented.users.insert_one({'_id': 'one', 'role': 'user'})
    consented.rfid_devices.insert_one({'_id': 'synthetic-device', 'device_id': 'synthetic-device', 'user_id': 'one',
        'active': True, 'key_hash': hashlib.sha256(b'synthetic-key').hexdigest(), 'last_seen': now,
        'reader_labels': ['첫째', '둘째', '셋째'], 'readers': []})
    monkeypatch.setattr(rfid, 'privacy_for', lambda _: {'guardian_consent': True, 'deletion_status': 'none'})
    monkeypatch.setattr(rfid, 'available_cards', lambda _: {})
    assert rfid.authenticate_device(consented, 'synthetic-device', 'synthetic-key')['user_id'] == 'one'
    with pytest.raises(HTTPException) as error:
        rfid.authenticate_device(consented, 'synthetic-device', 'wrong')
    assert error.value.status_code == 401
    assert rfid.board_state('one', 'synthetic-device', now=now + timedelta(seconds=19))['online']
    stale = rfid.board_state('one', 'synthetic-device', now=now + timedelta(seconds=20))
    assert not stale['online'] and all(row['status'] == 'STALE' for row in stale['readers'])


def test_scan_selected_regions_produce_decodable_crops_in_order(png_bytes):
    regions = [{'corners': [[0, 0], [1, 0], [1, 1], [0, 1]]}]
    cards = card_scan.crop_card_regions(png_bytes, 'image/png', json.dumps(regions))['cards']
    assert len(cards) == 1
    content = base64.b64decode(cards[0]['image'].split(',')[1])
    with Image.open(BytesIO(content)) as image:
        assert image.format == 'JPEG' and min(image.size) >= 128
    with pytest.raises(HTTPException) as error:
        card_scan.crop_card_regions(png_bytes, 'image/png', json.dumps([{'corners': [[2, 0]] * 4}]))
    assert error.value.status_code == 422


def test_text_card_filename_survives_catalog_response(db, png_bytes):
    from app.schemas.cards import CardResponse
    db.card_submissions.insert_one({'_id': 'text', 'owner_id': 'one', 'visibility': 'private',
        'status': 'approved', 'label': '기다려 주세요', 'meaning': '기다림', 'category': '요청',
        'created_at': datetime.now(timezone.utc),
        'image': {'data': png_bytes, 'content_type': 'image/png', 'filename': 'text-card.png'}})
    card = CardResponse.model_validate(card_submissions.approved_cards_for('one')[0])
    assert card.image_filename == 'text-card.png'
