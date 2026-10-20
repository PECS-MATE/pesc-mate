from contextlib import asynccontextmanager
from threading import Thread

from fastapi import FastAPI

from app.api.router import api_router
from app.services.indexes import ensure_indexes
from app.services.observability import configure_observability
from app.services.database_config import connection_options


@asynccontextmanager
async def lifespan(_app):
    # Required credentials must be valid before any background DB work or HTTP serving.
    connection_options()
    # Index creation must not delay startup or fail it while MongoDB is still starting.
    Thread(target=ensure_indexes, name='mongodb-indexes', daemon=True).start()
    yield


app = FastAPI(
    title="PESC MATE API",
    description="실물 PECS 카드의 휴대·관리 부담을 줄이고 의사소통과 학습을 지원하는 개인 맞춤형 디지털 AAC 플랫폼 API",
    version="0.1.0",
    lifespan=lifespan,
)

configure_observability(app)

app.include_router(api_router, prefix="/api")


@app.get("/")
async def root() -> dict[str, str]:
    return {"message": "PESC MATE API"}
