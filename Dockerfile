# syntax=docker/dockerfile:1

# The output is static files, so build once on the native platform.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Vite+: format, lint and type checks, then tests, then the production build.
RUN npm run check && npm test && npm run build

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY LICENSE /usr/share/nginx/html/LICENSE.txt
LABEL org.opencontainers.image.title="Booklet Imposer" \
      org.opencontainers.image.description="In-browser PDF booklet imposition" \
      org.opencontainers.image.licenses="EUPL-1.2"
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
