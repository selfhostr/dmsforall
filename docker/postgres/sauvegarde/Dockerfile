# Image of the `backup` service (docker-compose.yml, profile backup): nightly encrypted
# PostgreSQL dumps. Built on the same postgres:16-alpine as the database so that pg_dump matches
# the server major version.
#
#   docker compose --profile backup up -d     (AGE_CLE_PUBLIQUE must be set, see .env.example)
FROM postgres:16-alpine@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab

# bash and coreutils: the scripts use bash features and GNU date. age encrypts the dumps.
# rclone copies them off site when RCLONE_REMOTE is set.
RUN apk add --no-cache bash coreutils age tzdata rclone
ENV TZ=UTC

# Fixed uid/gid: the init-backups job of docker-compose.yml chowns the backup volume to 10001.
RUN addgroup -g 10001 sauvegarde \
  && adduser -D -u 10001 -G sauvegarde -h /var/lib/sauvegarde -s /bin/bash sauvegarde

COPY --chmod=0555 planifier.sh sauvegarder.sh purger.sh verifier-vivant.sh copier-hors-site.sh restaurer-test.sh planifier-test.sh /scripts/

USER sauvegarde
WORKDIR /var/lib/sauvegarde

# Default entrypoint: the nightly backup loop. planifier-test.sh (monthly restore test from the
# off-site copy) is shipped in the image and can be run as an alternative entrypoint.
ENTRYPOINT ["/scripts/planifier.sh"]
