"""Shared linguistic metadata helpers for built-in and user-created cards."""


def has_batchim(label):
    """Return whether the last Hangul syllable in a label has a final consonant."""
    for character in reversed(label.strip()):
        code = ord(character)
        if 0xAC00 <= code <= 0xD7A3:
            return (code - 0xAC00) % 28 != 0
    return False


def inferred_grammar(category):
    return {
        '사람': ('noun', 'subject'),
        '음식': ('noun', 'object'),
        '행동': ('verb', 'predicate'),
        '장소': ('noun', 'destination'),
        '감정': ('adjective', 'predicate'),
        '몸 상태': ('adjective', 'predicate'),
    }.get(category, ('noun', 'object'))


def with_inferred_metadata(card):
    part_of_speech, sentence_role = inferred_grammar(card.get('category', ''))
    return {
        **card,
        'meaning': card.get('meaning') or card['label'],
        'part_of_speech': card.get('part_of_speech') or part_of_speech,
        'has_batchim': card.get('has_batchim', has_batchim(card['label'])),
        'sentence_role': card.get('sentence_role') or sentence_role,
    }
