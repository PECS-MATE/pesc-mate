"""Learning settings and outcomes kept separate from communication history."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.services.database import database as _database, log_crud


ACTIVITY_TYPES = {'word_picture_match'}
DEFAULT_SETTINGS = {
    'category_ids': [],
    'question_count': 10,
    'option_count': 3,
    'repeat_frequency': 1,
    'time_limit_seconds': 60,
    'retry_enabled': True,
}


def _settings_public(document, user_id):
    return {
        'user_id': user_id,
        **{key: (document or {}).get(key, default) for key, default in DEFAULT_SETTINGS.items()},
        'updated_at': (document or {}).get('updated_at'),
        'updated_by': (document or {}).get('updated_by'),
    }


def settings_for(user_id):
    try:
        document = _database().learning_settings.find_one({'_id': user_id})
        log_crud('READ', 'learning_settings', '사용자 학습 설정 조회')
        return _settings_public(document, user_id)
    except PyMongoError as exc:
        raise HTTPException(503, '학습 설정을 불러오지 못했습니다.') from exc


def save_settings(user_id, actor_id, category_ids, question_count, option_count,
                  repeat_frequency, time_limit_seconds, retry_enabled):
    categories = list(dict.fromkeys(category_ids))
    if not categories:
        raise HTTPException(422, '학습 카테고리를 하나 이상 선택해 주세요.')
    now = datetime.now(timezone.utc)
    values = {
        'category_ids': categories,
        'question_count': question_count,
        'option_count': option_count,
        'repeat_frequency': repeat_frequency,
        'time_limit_seconds': time_limit_seconds,
        'retry_enabled': retry_enabled,
    }
    try:
        database = _database()
        before = _settings_public(database.learning_settings.find_one({'_id': user_id}), user_id)
        database.learning_settings.update_one(
            {'_id': user_id},
            {'$set': values | {'user_id': user_id, 'updated_at': now, 'updated_by': actor_id},
             '$setOnInsert': {'created_at': now}},
            upsert=True,
        )
        _audit(database, user_id, actor_id, 'learning_settings_changed', before, values)
        log_crud('UPDATE', 'learning_settings', '사용자 학습 설정 저장')
        return _settings_public(values | {'updated_at': now, 'updated_by': actor_id}, user_id)
    except PyMongoError as exc:
        raise HTTPException(503, '학습 설정을 저장하지 못했습니다.') from exc


def record_attempt(user_id, request_id, activity_type, category_id,
                   total_questions, correct_answers, duration_seconds):
    if activity_type not in ACTIVITY_TYPES:
        raise HTTPException(422, '지원하지 않는 학습 활동입니다.')
    if correct_answers > total_questions:
        raise HTTPException(422, '정답 수는 전체 문제 수보다 클 수 없습니다.')
    now = datetime.now(timezone.utc)
    document = {
        '_id': request_id,
        'user_id': user_id,
        'record_type': 'learning_attempt',
        'activity_type': activity_type,
        'category_id': category_id,
        'total_questions': total_questions,
        'correct_answers': correct_answers,
        'incorrect_answers': total_questions - correct_answers,
        'score': round(correct_answers / total_questions * 100),
        'duration_seconds': duration_seconds,
        'completed_at': now,
    }
    try:
        database = _database()
        existing = database.learning_attempts.find_one({'_id': request_id})
        if existing:
            if existing.get('user_id') != user_id:
                raise HTTPException(409, '이미 사용된 학습 요청 ID입니다.')
            return _attempt_public(existing)
        database.learning_attempts.insert_one(document)
        log_crud('CREATE', 'learning_attempts', '학습 시도 결과 저장')
        return _attempt_public(document)
    except DuplicateKeyError:
        existing = _database().learning_attempts.find_one({'_id': request_id})
        if existing and existing.get('user_id') == user_id:
            return _attempt_public(existing)
        raise HTTPException(409, '이미 사용된 학습 요청 ID입니다.')
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '학습 결과를 저장하지 못했습니다.') from exc


def _attempt_public(document):
    return {
        'id': str(document['_id']),
        **{key: document[key] for key in (
            'user_id', 'activity_type', 'category_id', 'total_questions',
            'correct_answers', 'incorrect_answers', 'score', 'duration_seconds', 'completed_at',
        )},
    }


def progress_for(user_id, days=None, now=None):
    reference = now or datetime.now(timezone.utc)
    query = {'user_id': user_id, 'record_type': 'learning_attempt'}
    if days is not None:
        query['completed_at'] = {'$gte': reference - timedelta(days=days)}
    try:
        rows = [_attempt_public(row) for row in
                _database().learning_attempts.find(query).sort('completed_at', -1)]
        log_crud('READ', 'learning_attempts', '사용자 학습 성취 조회')
    except PyMongoError as exc:
        raise HTTPException(503, '학습 성취를 불러오지 못했습니다.') from exc
    category_totals = defaultdict(lambda: {'attempts': 0, 'questions': 0, 'correct_answers': 0})
    for row in rows:
        item = category_totals[row['category_id']]
        item['attempts'] += 1
        item['questions'] += row['total_questions']
        item['correct_answers'] += row['correct_answers']
    total_questions = sum(row['total_questions'] for row in rows)
    correct_answers = sum(row['correct_answers'] for row in rows)
    return {
        'user_id': user_id,
        'period_days': days,
        'attempts': len(rows),
        'total_questions': total_questions,
        'correct_answers': correct_answers,
        'incorrect_answers': total_questions - correct_answers,
        'average_score': round(sum(row['score'] for row in rows) / len(rows)) if rows else 0,
        'last_completed_at': rows[0]['completed_at'] if rows else None,
        'categories': dict(category_totals),
        'recent': rows[:20],
    }


def audit_for(user_id):
    try:
        rows = _database().learning_audit_logs.find({'target_user_id': user_id}).sort('created_at', -1)
        return [{
            'id': str(row['_id']), 'target_user_id': row['target_user_id'],
            'actor_id': row['actor_id'], 'action': row['action'],
            'before': row.get('before'), 'after': row.get('after'),
            'created_at': row['created_at'],
        } for row in rows]
    except PyMongoError as exc:
        raise HTTPException(503, '학습 설정 변경 이력을 불러오지 못했습니다.') from exc


def _audit(database, user_id, actor_id, action, before, after):
    database.learning_audit_logs.insert_one({
        '_id': str(uuid4()), 'target_user_id': user_id, 'actor_id': actor_id,
        'action': action, 'before': before, 'after': after,
        'created_at': datetime.now(timezone.utc),
    })
    log_crud('CREATE', 'learning_audit_logs', '학습 설정 변경 기록')
