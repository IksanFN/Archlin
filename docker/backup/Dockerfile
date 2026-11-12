# Built on the Postgres image so pg_dump, pg_restore and psql match the server's major version.
FROM pgvector/pgvector:pg17
RUN apt-get update && apt-get install -y --no-install-recommends age jq && rm -rf /var/lib/apt/lists/*
COPY backup.sh backup-loop.sh restore-inside.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/backup-loop.sh /usr/local/bin/restore-inside.sh \
 && mkdir -p /backups && chown postgres:postgres /backups
USER postgres
ENTRYPOINT ["backup-loop.sh"]
