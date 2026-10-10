"""Curated language-review hints for card moderation."""
import re
import unicodedata


REFERENCE_TERMS = {
    '아아': {'term': '아아', 'kind': '약어', 'meaning': '아이스 아메리카노의 줄임말'},
    '얼죽아': {'term': '얼죽아', 'kind': '신조어', 'meaning': '얼어 죽어도 아이스 아메리카노를 즐긴다는 뜻'},
    '최애': {'term': '최애', 'kind': '신조어', 'meaning': '가장 사랑하거나 좋아하는 대상'},
    '킹받다': {'term': '킹받다', 'kind': '은어', 'meaning': '매우 화가 나거나 짜증이 난다는 뜻'},
    'tmi': {'term': 'TMI', 'kind': '약어', 'meaning': '굳이 알지 않아도 되는 과도한 정보'},
}

REFERENCE_NAME = '국립국어원 우리말샘·신어 자료 기반 내부 검토 사전'


def _compact(value):
    normalized = unicodedata.normalize('NFKC', value).casefold()
    return ''.join(character for character in normalized if character.isalnum())


def review_language(label, meaning):
    combined = f'{label} {meaning}'
    compact = _compact(combined)
    results = []
    for key, entry in REFERENCE_TERMS.items():
        if key in compact:
            results.append(entry | {'source': REFERENCE_NAME})

    known_terms = {result['term'].casefold() for result in results}
    for acronym in re.findall(r'\b[A-Z]{2,6}\b', unicodedata.normalize('NFKC', combined)):
        if acronym.casefold() not in known_terms:
            results.append({
                'term': acronym, 'kind': '약어 후보',
                'meaning': '등록된 뜻을 찾지 못했습니다. 운영 담당자 확인이 필요합니다.',
                'source': '내부 약어 형식 검사',
            })
    return results
