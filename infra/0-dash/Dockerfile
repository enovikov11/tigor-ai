FROM python:3-alpine
RUN apk add --no-cache git && pip install --no-cache-dir fastapi uvicorn
COPY app.py /app.py
COPY index.html /index.html
ENV GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0=safe.directory \
    GIT_CONFIG_VALUE_0=*
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "1337"]
