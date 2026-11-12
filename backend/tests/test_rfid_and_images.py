from types import SimpleNamespace
import subprocess

import pytest
from fastapi import HTTPException
from app.services import card_submissions, card_ocr, rfid


def test_personal_mapping_precedes_shared_and_resolve_keeps_input_order(db, monkeypatch):
    monkeypatch.setattr(rfid, 'shared_cards', lambda: {'water': {'id': 'water', 'label': '물'}})
    monkeypatch.setattr(rfid, 'available_cards', lambda _: {'water': {'id': 'water', 'label': '물'}, 'drink': {'id': 'drink', 'label': '마시다'}})
    db.rfid_shared_bindings.insert_one({'_id': 'AABBCCDD', 'card_id': 'water'})
    db.rfid_bindings.insert_one({'_id': 'one:AABBCCDD', 'user_id': 'one', 'uid': 'AABBCCDD', 'card_id': 'drink'})
    assert rfid.resolve_usb('one', ['11223344', 'AABBCCDD']) == [
        {'status': 'UNMAPPED', 'card_id': None, 'label': None}, {'status': 'PRESENT', 'card_id': 'drink', 'label': '마시다'}]
    assert rfid.resolve_usb('two', ['AABBCCDD'])[0]['card_id'] == 'water'


@pytest.mark.parametrize('data,content_type', [(b'not-an-image', 'image/png'), (b'', 'image/png'),
    (b'x' * (card_submissions.MAX_IMAGE_BYTES + 1), 'image/png')])
def test_image_decoder_rejects_invalid_or_oversized_upload(data, content_type):
    with pytest.raises(HTTPException) as error:
        card_submissions._normalize_image(data, content_type)
    assert error.value.status_code in (413, 422)


def test_valid_synthetic_image_is_decodable(png_bytes):
    display, _ = card_submissions._normalize_image(png_bytes, 'image/png')
    assert display


@pytest.mark.parametrize('text,expected', [('', ''), ('물', '물')])
def test_ocr_uses_local_synthetic_result_and_handles_empty_text(png_bytes, monkeypatch, text, expected):
    monkeypatch.setattr(card_ocr.shutil, 'which', lambda _: '/synthetic/tesseract')
    tsv = 'level\tpage_num\tblock_num\tpar_num\tline_num\ttext\n5\t1\t1\t1\t1\t' + text + '\n'
    monkeypatch.setattr(card_ocr.subprocess, 'run', lambda *a, **k: SimpleNamespace(stdout=tsv))
    result = card_ocr.recognize_card(png_bytes, 'image/png')
    assert result['suggested_label'] == expected
    assert result['candidates'] == ([expected] if expected else [])


def test_ocr_timeout_releases_slot_for_retry(png_bytes, monkeypatch):
    monkeypatch.setattr(card_ocr.shutil, 'which', lambda _: '/synthetic/tesseract')
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired('synthetic', 20)
    monkeypatch.setattr(card_ocr.subprocess, 'run', timeout)
    for _ in range(2):
        with pytest.raises(HTTPException) as error:
            card_ocr.recognize_card(png_bytes, 'image/png')
        assert error.value.status_code == 504
