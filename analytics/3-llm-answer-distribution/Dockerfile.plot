FROM docker.io/library/python:3.12-slim
RUN pip install --no-cache-dir matplotlib
WORKDIR /app
