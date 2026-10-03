# Postgres 16 with PostGIS from the PGDG apt repo. Built locally because the
# upstream postgis image is not published for arm64.
FROM postgres:16-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-postgis-3 \
 && rm -rf /var/lib/apt/lists/*
