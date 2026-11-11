#!/bin/sh
# Entrypoint of the web image: HTTPS certificate, then nginx.
#
# /certs is a bind mount (./data/certs). On the first start a self-signed certificate valid ten
# years is generated there and reused afterwards. To use your own certificate, put cert.pem (with
# its chain) and key.pem in ./data/certs and restart the web service.
# The nginx master process stays root (minimal capabilities), its workers run as nginx.
set -eu

CERTS=/certs

mkdir -p "$CERTS"

if [ ! -s "$CERTS/cert.pem" ] || [ ! -s "$CERTS/key.pem" ]; then
  alt="DNS:localhost,IP:127.0.0.1"
  if [ -n "${DFA_PUBLIC_URL:-}" ]; then
    host="${DFA_PUBLIC_URL#*://}"
    host="${host%%/*}"
    host="${host%%:*}"
    alt="$alt,DNS:$host"
  fi
  umask 077
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 \
    -subj "/CN=dmsforall" -addext "subjectAltName=$alt" \
    -keyout "$CERTS/key.tmp" -out "$CERTS/cert.tmp" 2>/dev/null
  mv "$CERTS/key.tmp" "$CERTS/key.pem"
  mv "$CERTS/cert.tmp" "$CERTS/cert.pem"
  chmod 0600 "$CERTS/key.pem"
  chmod 0644 "$CERTS/cert.pem"
  echo "dmsforall: generated a self-signed certificate in ./data/certs (replace cert.pem and key.pem to use your own)"
fi

exec "$@"
