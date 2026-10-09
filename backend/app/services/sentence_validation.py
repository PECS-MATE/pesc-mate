"""Validate that generated sentences preserve the selected card meanings."""
import re
import unicodedata


SEMANTIC_TOKENS = {
    'me': ('저는', '제가', '저를', '저도', '나는', '내가', '나를', '나도'),
    'mom': ('엄마',),
    'water': ('물',),
    'rice': ('밥',),
    'apple': ('사과',),
    'milk': ('우유',),
    'drink': ('마시', '마셔', '마실'),
    'eat': ('먹',),
    'go': ('가고', '가요', '갈래', '갈게', '갑니다', '이동'),
    'rest': ('쉬', '쉴', '휴식'),
    'play': ('놀', '놀이'),
    'help': ('도와', '도움'),
    'toilet': ('화장실',),
    'home': ('집', '가정'),
    'happy': ('좋', '행복', '기뻐'),
    'hurt': ('아프', '아파', '통증', '다쳤'),
    'no': ('싫', '아니', '않', '못', '거절', '원하지'),
    'yes': ('네', '응', '동의', '좋아'),
    'stop': ('그만', '중단', '멈춰'),
    'more': ('더', '추가'),
    'again': ('다시', '한번더'),
    'wait': ('기다려', '기다릴', '잠시'),
    'unknown': ('모르', '알수없'),
    'other': ('다른',),
    'head': ('머리',),
    'stomach': ('배', '복부'),
    'hand': ('손',),
    'leg': ('다리',),
    'here_hurts': ('아프', '통증'),
    'uncomfortable': ('불편',),
    'scared': ('무서', '두려'),
    'noisy': ('시끄러', '소리가커'),
}

PROHIBITED_TOKENS = ('시발', '씨발', '병신', '개새끼', '지랄')
HARMFUL_TOKENS = ('자해', '살인', '죽어버려', '죽고싶', '때려죽', '해치고싶')
PERSONAL_INFERENCE_TOKENS = (
    '전화번호는', '주소는', '사는곳은', '학교이름은', '주민등록번호',
    '자폐라서', '장애가있어서', '진단받아서', '병이있어서',
)
PERSONAL_DATA_PATTERNS = (
    re.compile(r'(?<!\d)01[016789][- ]?\d{3,4}[- ]?\d{4}(?!\d)'),
    re.compile(r'(?<!\d)\d{6}[- ]?[1-4]\d{6}(?!\d)'),
    re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'),
)


def _normalize(value):
    normalized = unicodedata.normalize('NFKC', value).lower()
    return re.sub(r'[^0-9a-z가-힣]', '', normalized)


def _tokens_for(card):
    if card['id'] in SEMANTIC_TOKENS:
        return SEMANTIC_TOKENS[card['id']]
    label = card['label'].strip()
    if card.get('part_of_speech') in {'verb', 'adjective'} and label.endswith('다'):
        return (label, label[:-1])
    return (label,)


def validate_semantics(cards, generated_sentence):
    normalized_sentence = _normalize(generated_sentence)
    missing = []
    checked = set()
    for card in cards:
        if card['id'] in checked:
            continue
        checked.add(card['id'])
        tokens = tuple(_normalize(token) for token in _tokens_for(card))
        if not any(token and token in normalized_sentence for token in tokens):
            missing.append(card['id'])
    return {'passed': not missing, 'missing_card_ids': missing}


def validate_safety(generated_sentence):
    normalized = _normalize(generated_sentence)
    flags = []
    if any(token in normalized for token in PROHIBITED_TOKENS):
        flags.append('prohibited_language')
    if any(token in normalized for token in HARMFUL_TOKENS):
        flags.append('harmful_expression')
    if any(pattern.search(generated_sentence) for pattern in PERSONAL_DATA_PATTERNS):
        flags.append('personal_data')
    if any(token in normalized for token in PERSONAL_INFERENCE_TOKENS):
        flags.append('personal_inference')
    return {'passed': not flags, 'flags': flags}
