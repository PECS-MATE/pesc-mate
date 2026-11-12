"""cards HTTP boundary; public paths and handler names are preserved."""
from typing import Literal
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from starlette.responses import JSONResponse
from app.services.communication import CARDS
from app.services.authentication import current_user, require_account_permission
from app.services.support_links import SUPPORT_ROLES
from app.services.card_submissions import MAX_IMAGE_BYTES, approved_cards_for, create_submission, image_for, review_submission, submissions_for, submissions_for_review, submit_draft, update_submission, replace_submission_image
from app.services.card_ocr import recognize_card
from app.services.card_scan import detect_card_regions, crop_card_regions
from app.services.categories import active_categories, categories_for_admin, create_category, update_category
from app.services.reauthentication import reauthenticate_content_operator
from app.schemas.cards import CardResponse, CardReviewRequest, CardSubmissionResponse, CardUpdateRequest, CategoryCreateRequest, CategoryResponse, CategoryUpdateRequest
from app.api.dependencies import _card_owner, _require_support_manager, require_communicator, require_guardian_consent
from app.api.image_response import _image_response

router = APIRouter()


@router.get('/cards/builtin', response_model=list[CardResponse], response_model_exclude_none=True, tags=['카드'])
def builtin_cards(response: Response, user=Depends(current_user)):
    # Shared starter boards need no child link and must never include personal cards.
    response.headers['Cache-Control'] = 'no-store'
    return CARDS


@router.get('/cards', response_model=list[CardResponse], response_model_exclude_none=True, tags=['카드'])
def cards(response: Response, user=Depends(current_user)):
    require_communicator(user)
    response.headers['Cache-Control'] = 'no-store'
    return CARDS + approved_cards_for(user['id'])


@router.get('/categories', response_model=list[CategoryResponse], tags=['카드'])
def categories(_user=Depends(current_user)):
    return active_categories()


@router.post('/cards/ocr', tags=['카드'])
def recognize_card_image(user_id: str = Form(min_length=1, max_length=64),
                         image: UploadFile = File(), user=Depends(current_user)):
    if user['role'] not in SUPPORT_ROLES:
        raise HTTPException(403, '보호자 또는 지원자만 사진 글자 인식을 사용할 수 있습니다.')
    owner_id = _card_owner(user, user_id)
    require_guardian_consent({'id': owner_id})
    result = recognize_card(image.file.read(MAX_IMAGE_BYTES + 1), image.content_type)
    return JSONResponse(result, headers={'Cache-Control': 'no-store'})


@router.post('/cards/scan', tags=['카드'])
def scan_physical_cards(image: UploadFile = File(),
                         scope: Literal['private', 'shared'] = Form(default='private'),
                         user_id: str | None = Form(default=None, max_length=64),
                         regions: str | None = Form(default=None, max_length=8192),
                         user=Depends(current_user)):
    if scope == 'shared':
        require_account_permission(user, 'content_manage')
    else:
        if user['role'] not in SUPPORT_ROLES:
            raise HTTPException(403, '보호자 또는 담당자만 실물 카드를 가져올 수 있습니다.')
        owner_id = _card_owner(user, user_id)
        require_guardian_consent({'id': owner_id})
    data = image.file.read(MAX_IMAGE_BYTES + 1)
    result = (detect_card_regions(data, image.content_type) if regions is None else
              crop_card_regions(data, image.content_type, regions))
    return JSONResponse(result, headers={'Cache-Control': 'no-store'})


@router.get('/cards/submissions', response_model=list[CardSubmissionResponse], tags=['카드'])
def card_submissions(user_id: str | None = Query(default=None, max_length=64),
                     user=Depends(current_user)):
    return submissions_for(_card_owner(user, user_id))


@router.post('/cards/submissions', response_model=CardSubmissionResponse, status_code=201, tags=['카드'])
async def submit_card(label: str = Form(min_length=1, max_length=30),
                      meaning: str | None = Form(default=None, max_length=120),
                      category: str = Form(min_length=1, max_length=30),
                      visibility: str = Form(),
                      submission_mode: str = Form(default='submit'),
                      image_edits: str | None = Form(default=None, max_length=256),
                      user_id: str | None = Form(default=None, max_length=64),
                      image: UploadFile = File(),
                      user=Depends(current_user)):
    owner_id = _card_owner(user, user_id)
    require_guardian_consent({'id': owner_id})
    image_data = await image.read(MAX_IMAGE_BYTES + 1)
    return create_submission(owner_id, label, meaning, category, visibility,
                             image.filename, image.content_type, image_data, submission_mode,
                             actor_id=user['id'], image_edits=image_edits)


@router.post('/cards/submissions/{submission_id}/submit', response_model=CardSubmissionResponse, tags=['카드'])
def request_card_review(submission_id: str,
                        user_id: str | None = Query(default=None, max_length=64),
                        user=Depends(current_user)):
    owner_id = _card_owner(user, user_id)
    require_guardian_consent({'id': owner_id})
    return submit_draft(submission_id, owner_id, actor_id=user['id'])


@router.patch('/cards/submissions/{submission_id}', response_model=CardSubmissionResponse, tags=['카드'])
def edit_card_submission(submission_id: str, request: CardUpdateRequest,
                         user_id: str | None = Query(default=None, max_length=64),
                         user=Depends(current_user)):
    owner_id = _card_owner(user, user_id)
    require_guardian_consent({'id': owner_id})
    return update_submission(submission_id, owner_id, request.label, request.meaning,
                             request.category, request.visibility, actor_id=user['id'])


@router.put('/cards/submissions/{submission_id}/image', response_model=CardSubmissionResponse, tags=['카드'])
async def replace_card_submission_image(submission_id: str, user_id: str = Form(min_length=1, max_length=64),
                                        expected_revision: int = Form(ge=0), image: UploadFile = File(),
                                        image_edits: str | None = Form(default=None, max_length=256),
                                        user=Depends(current_user)):
    owner_id = _require_support_manager(user, user_id, 'cards_manage')
    require_guardian_consent({'id': owner_id})
    data = await image.read(MAX_IMAGE_BYTES + 1)
    return replace_submission_image(submission_id, owner_id, user, image.content_type, data,
                                    expected_revision, image_edits)


@router.get('/cards/submissions/{submission_id}/image', tags=['카드'])
def card_submission_image(submission_id: str, request: Request, variant: Literal['display', 'thumbnail'] = 'display', user=Depends(current_user)):
    content, content_type = image_for(submission_id, user, variant)
    return _image_response(request, content, content_type)


@router.get('/admin/card-submissions', response_model=list[CardSubmissionResponse], tags=['운영'])
def admin_card_submissions(user=Depends(current_user)):
    require_account_permission(user, 'content_manage')
    return submissions_for_review()


@router.post('/admin/cards', response_model=CardSubmissionResponse, status_code=201, tags=['운영'])
async def publish_admin_card(label: str = Form(min_length=1, max_length=30),
                             meaning: str | None = Form(default=None, max_length=120),
                             category: str = Form(min_length=1, max_length=30),
                             image: UploadFile = File(), user=Depends(current_user)):
    require_account_permission(user, 'content_manage')
    data = await image.read(MAX_IMAGE_BYTES + 1)
    return create_submission(user['id'], label, meaning, category, 'shared',
                             image.filename, image.content_type, data, content_operator=user)


@router.post('/admin/cards/ocr', tags=['운영'])
def recognize_admin_card_image(image: UploadFile = File(), user=Depends(current_user)):
    require_account_permission(user, 'content_manage')
    result = recognize_card(image.file.read(MAX_IMAGE_BYTES + 1), image.content_type)
    return JSONResponse(result, headers={'Cache-Control': 'no-store'})


@router.patch('/admin/card-submissions/{submission_id}', response_model=CardSubmissionResponse, tags=['운영'])
def review_card_submission(submission_id: str, request: CardReviewRequest, http_request: Request, response: Response,
                           user=Depends(current_user)):
    reauthenticate_content_operator(user, request.password.get_secret_value(),
                                    http_request.client.host if http_request.client else None)
    response.headers['Cache-Control'] = 'no-store'
    return review_submission(submission_id, user['id'], request.decision, request.reason)


@router.get('/admin/categories', response_model=list[CategoryResponse], tags=['운영'])
def admin_categories(user=Depends(current_user)):
    require_account_permission(user, 'content_manage')
    return categories_for_admin()


@router.post('/admin/categories', response_model=CategoryResponse, status_code=201, tags=['운영'])
def add_category(request: CategoryCreateRequest, http_request: Request, response: Response, user=Depends(current_user)):
    reauthenticate_content_operator(user, request.password.get_secret_value(),
                                    http_request.client.host if http_request.client else None)
    response.headers['Cache-Control'] = 'no-store'
    return create_category(request.name, request.display_order)


@router.patch('/admin/categories/{category_id}', response_model=CategoryResponse, tags=['운영'])
def edit_category(category_id: str, request: CategoryUpdateRequest, http_request: Request, response: Response,
                  user=Depends(current_user)):
    reauthenticate_content_operator(user, request.password.get_secret_value(),
                                    http_request.client.host if http_request.client else None)
    response.headers['Cache-Control'] = 'no-store'
    return update_category(category_id, request.name, request.display_order, request.active)
