"""Compose API routers. Domain handlers and DTOs live in their own modules."""
from fastapi import APIRouter
from app.api.rfid import router as rfid_router
from app.api.practice_suggestions import router as practice_suggestions_router
from app.api.learning_program import router as learning_program_router
from app.api.card_image_tools import router as card_image_tools_router
from app.api.a4_projects import router as a4_projects_router
from app.api.auth import router as auth_router
from app.api.accounts import router as accounts_router
from app.api.boards import router as boards_router
from app.api.cards import router as cards_router
from app.api.communication import router as communication_router
from app.api.learning import router as learning_router
from app.api.records import router as records_router
from app.api.recommendations import router as recommendations_router
from app.api.settings import router as settings_router
from app.api.operations import router as operations_router

api_router = APIRouter()
api_router.include_router(rfid_router)
api_router.include_router(practice_suggestions_router)
api_router.include_router(learning_program_router)
api_router.include_router(card_image_tools_router)
api_router.include_router(a4_projects_router)
api_router.include_router(auth_router)
api_router.include_router(accounts_router)
api_router.include_router(boards_router)
api_router.include_router(settings_router)
api_router.include_router(cards_router)
api_router.include_router(communication_router)
api_router.include_router(learning_router)
api_router.include_router(records_router)
api_router.include_router(recommendations_router)
api_router.include_router(operations_router)
