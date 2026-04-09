FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir flask requests beautifulsoup4 tqdm gunicorn

COPY app.py .
COPY templates/ templates/

ENV PORT=5000
ENV GHOST_DOWNLOAD_DIR=/app/tmp_downloads

EXPOSE 5000

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--threads", "8", "--timeout", "300", "app:app"]
