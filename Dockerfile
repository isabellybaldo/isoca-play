# The image holds the installed package, its hash-pinned dependencies and the built
# frontend. Tests run in CI from the checkout, not in here.

FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts
# web/src imports ../../../shared/*.json.
COPY shared/ /src/shared/
COPY web/ ./
RUN npm run build

FROM python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337 AS package
WORKDIR /src
# The build tool stays in this stage's /opt/build; only /opt/venv moves on.
COPY server/requirements.txt server/requirements-build.txt ./
RUN python -m venv /opt/build \
    && /opt/build/bin/pip install --no-cache-dir --require-hashes -r requirements-build.txt \
    && python -m venv --without-pip /opt/venv \
    && /opt/build/bin/pip --python /opt/venv/bin/python install --no-cache-dir \
        --require-hashes --only-binary :all: -r requirements.txt
COPY server/pyproject.toml ./
COPY server/isoca_play/ isoca_play/
RUN /opt/build/bin/pip wheel --no-cache-dir --no-deps --no-build-isolation --wheel-dir /wheels . \
    && /opt/build/bin/pip --python /opt/venv/bin/python install --no-cache-dir --no-deps --no-index /wheels/*.whl

FROM python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337 AS runtime
COPY --from=package /opt/venv /opt/venv
COPY --from=web /src/web/dist /app/web/dist
# Nothing here installs anything at run time. /data is the one writable place; the box
# mounts its own directory over it.
RUN rm -rf /usr/local/lib/python3.12/site-packages/pip* /usr/local/bin/pip* \
    && install -d -o 10001 -g 10001 -m 0750 /data
ARG VERSION=dev
ENV PATH="/opt/venv/bin:$PATH" \
    DB_PATH=/data/play.db \
    STATIC_DIR=/app/web/dist \
    APP_VERSION="$VERSION" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --start-interval=2s \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=4)"]
# One worker. Proxy headers stay off: the app reads the rightmost X-Forwarded-For itself.
CMD ["uvicorn", "--factory", "isoca_play.app:app_from_env", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-proxy-headers", "--no-server-header"]
