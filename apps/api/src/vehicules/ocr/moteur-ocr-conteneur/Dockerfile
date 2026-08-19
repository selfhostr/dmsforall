# Service OCR dédié — reconnaissance du permis de circulation suisse. Auto-hébergé, aucun appel
# réseau à l'exécution : `fra.traineddata` (Tesseract, français — labels des libellés du permis
# reconnus fiablement même en allemand/italien, mesuré) est téléchargé au BUILD, pas au runtime.
#
# node:22-bookworm-slim plutôt qu'alpine : sharp télécharge un binaire prébuilt glibc, plus simple
# et plus robuste qu'une recompilation musl. Image cible ~350-450 Mo (mesuré, voir rapport de
# livraison) — pas d'alpine à gagner, pas de chaîne de compilation C++ à installer non plus
# (tesseract.js = WASM pur, heic-convert = JS pur, sharp = binaire prébuilt téléchargé par npm).

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app/tessdata \
    && curl -fsSL -o /app/tessdata/fra.traineddata \
       https://github.com/tesseract-ocr/tessdata_fast/raw/main/fra.traineddata \
    && apt-get purge -y curl && apt-get autoremove -y
COPY --from=build /app/node_modules ./node_modules
COPY package.json server.mjs pretraitement.mjs ancres.mjs geometrie.mjs zones-cadrees.mjs moteur-tesseract.mjs extraction-champs.mjs ./

ENV OCR_TESSDATA_PATH=/app/tessdata
ENV PORT=8090
EXPOSE 8090

# Utilisateur non-root : ce service décode des documents d'identité en mémoire, une compromission
# ne doit pas donner un accès root au conteneur.
RUN useradd --system --uid 10001 ocr
USER ocr

CMD ["node", "server.mjs"]
