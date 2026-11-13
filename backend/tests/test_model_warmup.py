from io import BytesIO
import json

from app.services import model


def test_warmup_prepares_shared_prompt_without_user_data(monkeypatch):
    monkeypatch.setenv('OLLAMA_ENABLED', 'true')
    calls = []
    def response(request, **kwargs):
        calls.append(json.loads(request.data))
        return BytesIO(json.dumps({'done': True, 'response': '물을 마시고 싶어요.'}).encode())
    monkeypatch.setattr(model, 'urlopen', response)
    assert model.warmup()
    text, source = model.generate_sentence(['물', '마시다'], '물을 마시고 싶어요.')
    assert source == 'ollama'
    assert calls[0]['system'] == calls[1]['system']
    assert calls[0]['prompt'].split('카드:')[0] == calls[1]['prompt'].split('카드:')[0]
    assert '카드: []' in calls[0]['prompt']
    assert calls[0]['options']['num_predict'] == 1
    assert calls[1]['options']['num_predict'] >= 32
    assert not model._warming.is_set()


def test_self_card_prompt_preserves_the_selected_subject_explicitly():
    assert '반드시 저는을 넣으세요' in model._sentence_prompt(['나', '물', '마시다'], '저는 물을 마셔요.')
    assert '주어를 추가하지 마세요' in model._sentence_prompt(['물', '마시다'], '물을 마셔요.')
