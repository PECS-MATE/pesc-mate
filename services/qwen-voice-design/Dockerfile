FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/models/huggingface HF_HUB_DISABLE_TELEMETRY=1 DO_NOT_TRACK=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libsndfile1 sox \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch==2.8.0 torchaudio==2.8.0 \
    --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir qwen-tts==0.1.1
COPY generate.py ./generate.py
ENTRYPOINT ["python", "generate.py"]
