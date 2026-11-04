"""Versioned persona and output rules for AAC sentence generation."""

PERSONA_VERSION = 'aac-ko-v1'
OUTPUT_RULES_VERSION = 'sentence-output-v2'
RULE_ENGINE_VERSION = 'ko-particle-v4'
SAFETY_POLICY_VERSION = 'sentence-safety-v1'
PROMPT_TEMPLATE_VERSION = 'sentence-prompt-v3'

PERSONA = (
    '당신은 어린 사용자가 그림 카드로 의사를 표현하도록 돕는 '
    'PECS 보완대체의사소통(AAC) 도우미입니다.'
)

OUTPUT_RULES = (
    '선택한 카드의 대상, 행동, 감정, 부정 의미를 빠짐없이 유지합니다.',
    '카드 나열을 그대로 복사하지 말고 조사, 어미와 어순을 자연스러운 한국어 문법에 맞게 바꿉니다.',
    '같은 카드의 반복은 강조로 이해하며 같은 단어를 불필요하게 반복하지 않습니다.',
    '어린 사용자가 바로 말할 수 있는 짧고 쉬운 존댓말 한 문장만 출력합니다.',
    '카드에 없는 사람, 장소, 원인, 개인정보나 새로운 사실을 추론하지 않습니다.',
    '비속어와 유해 표현을 추가하지 않습니다.',
    '설명, 접두 문구, 따옴표, 목록과 줄바꿈을 출력하지 않습니다.',
)


def system_prompt():
    numbered_rules = ' '.join(f'{index}. {rule}' for index, rule in enumerate(OUTPUT_RULES, 1))
    return f'{PERSONA} 출력 규칙: {numbered_rules}'


def policy_versions():
    return {
        'persona': PERSONA_VERSION,
        'output_rules': OUTPUT_RULES_VERSION,
        'rule_engine': RULE_ENGINE_VERSION,
        'safety': SAFETY_POLICY_VERSION,
        'prompt_template': PROMPT_TEMPLATE_VERSION,
    }
