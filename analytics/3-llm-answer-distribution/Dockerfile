FROM docker.io/library/python:3.12-slim
WORKDIR /app
COPY worker.py query.py /app/
VOLUME /data
ENTRYPOINT ["python3", "-u", "/app/worker.py"]
