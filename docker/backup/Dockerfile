# Image of the `backup` service (docker-compose.yml): a daily PostgreSQL dump plus a copy of the
# uploaded files, written to ./backups. Built on the same postgres:16-alpine as the database so
# that pg_dump matches the server major version.
FROM postgres:16-alpine@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab

# tzdata: the backup hour follows TZ. age: optional encryption (AGE_CLE_PUBLIQUE).
RUN apk add --no-cache tzdata age
ENV TZ=UTC

# Same uid/gid as the dfa user of the api image: it reads the secrets and the uploaded files.
RUN addgroup -g 101 -S dfa && adduser -S -u 100 -G dfa -h /backups -s /sbin/nologin dfa

COPY --chmod=0755 entrypoint.sh planifier.sh sauvegarder.sh purger.sh restaurer.sh /scripts/

# Starts as root only to hand /backups to dfa, then switches (see entrypoint.sh).
ENTRYPOINT ["/scripts/entrypoint.sh"]
CMD ["/scripts/planifier.sh"]
