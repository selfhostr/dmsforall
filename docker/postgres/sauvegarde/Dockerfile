# syntax=docker/dockerfile:1
#
# Image du service `backup` (docker-compose.yml) : sauvegarde nocturne de PostgreSQL,
# planifiée par un simple boucle bash (planifier.sh), jamais par un cron/systemd du serveur —
# cohérent avec le choix du reste de docker-compose.yml (« TOUT en conteneurs »).
#
# Construite sur `postgres:16-alpine` — la MÊME image et le MÊME tag que le service `postgres`
# de docker-compose.yml — plutôt qu'une base générique, pour la raison qui motive déjà ce
# choix ailleurs dans ce dépôt (voir le commentaire du service `postgres`) : `pg_dump`/`pg_restore`
# doivent être EXACTEMENT la même version majeure que le serveur sauvegardé. Un `pg_dump` 17 (ou
# 15) contre un serveur 16 est un risque de format de dump subtilement incompatible, découvert le
# jour où on a besoin de restaurer — jamais avant. Coût accepté : cette image embarque aussi le
# serveur PostgreSQL lui-même (jamais démarré ici), plus lourd qu'une image `-client` dédiée qui
# n'existe pas officiellement pour Alpine — non chiffrant à ce stade (philosophie §0 : pas de
# multi-stage sophistiqué avant besoin réel de taille d'image).
FROM postgres:16-alpine

# bash      : scripts plus lisibles que POSIX sh strict (tableaux, mktemp --suffix, [[ ]]).
# coreutils : `date`/`mktemp` GNU — le `date` de busybox (fourni par défaut dans Alpine) ne sait
#             ni parser fiablement une date arbitraire (`date -d "20260101"`) ni servir à
#             l'arithmétique de purger.sh (échéances hebdo/mensuelles) ; `mktemp --suffix` est
#             également une extension GNU absente de busybox.
# age       : chiffrement asymétrique au repos (voir sauvegarder.sh — clé publique seulement ici,
#             jamais la clé privée).
# tzdata    : nécessaire pour qu'Europe/Zurich soit réellement résolu par `date` (musl seul ne
#             suffit pas, il lui faut la base de données de zones sur disque).
RUN apk add --no-cache bash coreutils age tzdata

ENV TZ=Europe/Zurich

# Utilisateur non-root DÉDIÉ avec uid/gid EXPLICITES (10001) — contrairement à `apps/api/Dockerfile`
# (qui laisse Alpine attribuer le premier uid système disponible, fragilité documentée dans
# docker-compose.yml), pour que le service `init-sauvegardes` de docker-compose.yml
# puisse chown()er le volume `dfa_postgres_backups` vers une valeur STABLE, connue sans devoir
# lancer un conteneur pour la découvrir.
RUN addgroup -g 10001 sauvegarde \
  && adduser -D -u 10001 -G sauvegarde -h /var/lib/sauvegarde -s /bin/bash sauvegarde

COPY --chmod=0555 planifier.sh sauvegarder.sh purger.sh verifier-vivant.sh /scripts/

USER sauvegarde
WORKDIR /var/lib/sauvegarde

ENTRYPOINT ["/scripts/planifier.sh"]
