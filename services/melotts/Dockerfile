FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/models/huggingface NLTK_DATA=/models/nltk \
    HF_HUB_DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 \
    OMP_NUM_THREADS=2 PYTHONPATH=/opt/MeloTTS
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential libsndfile1 libmecab-dev mecab \
    && rm -rf /var/lib/apt/lists/*
ARG MELO_REVISION=209145371cff8fc3bd60d7be902ea69cbdb7965a
RUN git clone https://github.com/myshell-ai/MeloTTS.git /opt/MeloTTS \
    && git -C /opt/MeloTTS checkout "$MELO_REVISION"
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir 'numpy<2' 'setuptools<81' typing_extensions==4.14.1 \
    && pip install --no-cache-dir torch==2.2.2+cpu torchaudio==2.2.2+cpu \
       --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple
# Use the pinned upstream inference dependencies; the Gradio UI/training dashboard are not served.
RUN sed '/^torch$/d; /^torchaudio$/d; /^gradio$/d; /^tensorboard/d' /opt/MeloTTS/requirements.txt > /tmp/inference.txt \
    && pip install --no-cache-dir -r /tmp/inference.txt 'numpy<2' 'fastapi>=0.115,<1' 'uvicorn>=0.30,<1' \
    && python -m unidic download
RUN pip install --no-cache-dir python-mecab-ko==1.3.7 python-mecab-ko-dic==2.1.1.post2 \
    && mkdir -p /models/nltk && ln -s /models/nltk /root/nltk_data
COPY server.py ./server.py
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8090", "--no-access-log"]
