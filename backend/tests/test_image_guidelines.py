import json
from pathlib import Path
import pytest
from app.services.image_guidelines import card_image_prompt, reference_context

@pytest.mark.parametrize('label', ['물','밥','사과','우유','간식'])
def test_object_rules_keep_photo_style(label):
    assert reference_context(label)['reference_ids'] == ['aac-common','photo']

def test_rules_only_source_has_no_fixed_scenes():
    knowledge=json.loads((Path(__file__).parents[1]/'app/data/card-image-guidelines.json').read_text(encoding='utf-8'))
    assert 'scenes' not in knowledge
    for label in ['나','화장실','배','좋아요']:
        assert not any(key.startswith('scene:') for key in reference_context(label)['reference_ids'])

def test_user_scene_is_preserved_but_common_rules_have_priority():
    prompt,context=card_image_prompt('화장실','변기 옆에 작은 세면대','장소')
    assert '변기 옆에 작은 세면대' in prompt
    assert '양변기 하나만' not in prompt
    assert '1024x1024' in prompt and '#ffffff' in prompt and '10%' in prompt
    assert prompt.index('RETRIEVED_GUIDELINES') < prompt.index('CARD_DATA')
    assert context['reference_ids']==['aac-common','symbol']

def test_custom_card_uses_rendering_rules_for_selected_category():
    assert reference_context('새 동작','행동')['reference_ids']==['aac-common','symbol']
    assert reference_context('새 물건','사물')['reference_ids']==['aac-common','photo']
