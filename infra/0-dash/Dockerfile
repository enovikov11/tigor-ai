FROM python:3-alpine
RUN pip install --no-cache-dir fastapi uvicorn
COPY app.py /app.py
COPY index.html /index.html
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "1337"]
