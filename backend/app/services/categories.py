"""Ordered card categories used until category administration moves to MongoDB."""

CATEGORIES = [
    {'id': 'people', 'name': '사람', 'display_order': 1, 'active': True},
    {'id': 'food', 'name': '음식', 'display_order': 2, 'active': True},
    {'id': 'actions', 'name': '행동', 'display_order': 3, 'active': True},
    {'id': 'places', 'name': '장소', 'display_order': 4, 'active': True},
    {'id': 'emotions', 'name': '감정', 'display_order': 5, 'active': True},
    {'id': 'furniture', 'name': '가구', 'display_order': 6, 'active': True},
    {'id': 'household-items', 'name': '생활용품', 'display_order': 7, 'active': True},
    {'id': 'learning', 'name': '학습', 'display_order': 8, 'active': True},
    {'id': 'user-cards', 'name': '사용자 카드', 'display_order': 9, 'active': True},
]


def active_categories():
    return [dict(category) for category in CATEGORIES if category['active']]


def active_category_names():
    return {category['name'] for category in active_categories()}
