#!/usr/bin/env bash
# Instala ou atualiza o Radar Sonoro num servidor Ubuntu. Rode como root:
#   curl -fsSL https://raw.githubusercontent.com/samvitor-git/radar-sonoro/main/install.sh | bash
set -euo pipefail

REPO="${REPO:-https://github.com/samvitor-git/radar-sonoro}"
BRANCH="${BRANCH:-main}"
DIR="${DIR:-/opt/radar-sonoro}"
DOMAIN="${DOMAIN:-radarsonoro.vitorgouveia.com.br}"
CLIENT_ID="${CLIENT_ID:-5674d190ccdd4f93848efe9bf8180b83}"

say() { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\n\033[1;33m!!\033[0m %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Rode como root (ou com sudo)."; exit 1; }

say "Instalando dependências do sistema"
apt-get update -qq
apt-get install -y -qq curl ca-certificates tar dnsutils >/dev/null
if ! command -v docker >/dev/null 2>&1; then
  say "Instalando o Docker"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true

say "Baixando o Radar Sonoro"
mkdir -p "$DIR"
TMP="$(mktemp -d)"
curl -fsSL "$REPO/archive/refs/heads/$BRANCH.tar.gz" | tar -xz -C "$TMP" --strip-components=1
# Atualiza o código sem tocar nos dados nem no .env.
cp -a "$TMP"/. "$DIR"/
rm -rf "$TMP"
cd "$DIR"
mkdir -p data
chown -R 1000:1000 data

if [ ! -f .env ]; then
  say "Configurando o acesso ao Spotify"
  echo "Abra developer.spotify.com > seu app > Settings, clique em 'View client secret' e copie."
  SECRET=""
  while [ -z "$SECRET" ]; do
    read -rsp "Cole aqui o Client Secret e aperte Enter (não aparece na tela): " SECRET </dev/tty
    echo
  done
  cat > .env <<EOF
DOMAIN=$DOMAIN
SPOTIFY_CLIENT_ID=$CLIENT_ID
SPOTIFY_CLIENT_SECRET=$SECRET
SPOTIFY_REDIRECT_URI=https://$DOMAIN/callback
POLL_MINUTES=30
EOF
  chmod 600 .env
fi

PROXY_CONTAINER="${PROXY_CONTAINER:-meu-dia-caddy-1}"
PROXY_NETWORK="${PROXY_NETWORK:-meu-dia_frontend}"
grep -q '^PROXY_NETWORK=' .env || echo "PROXY_NETWORK=$PROXY_NETWORK" >> .env

if ! docker ps --format '{{.Names}}' | grep -qx "$PROXY_CONTAINER"; then
  warn "Não encontrei o proxy $PROXY_CONTAINER rodando. Nada foi alterado."
  exit 1
fi
if ! docker network inspect "$PROXY_NETWORK" >/dev/null 2>&1; then
  warn "Não encontrei a rede $PROXY_NETWORK. Nada foi alterado."
  exit 1
fi

say "Subindo a aplicação"
docker compose up -d --build --remove-orphans

say "Ligando o domínio no proxy $PROXY_CONTAINER"
CF="$(docker inspect "$PROXY_CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')"
if [ -z "$CF" ] || [ ! -f "$CF" ]; then
  warn "Não achei o Caddyfile do proxy. O app está no ar, mas o domínio ainda não foi ligado."
  exit 1
fi
if grep -qE "^${DOMAIN//./\\.}[[:space:]]*\{" "$CF"; then
  echo "O domínio já estava configurado em $CF. Nada a mudar."
else
  BACKUP="$CF.bak-radar-$(date +%Y%m%d%H%M%S)"
  cp -p "$CF" "$BACKUP"
  # Acrescenta no fim do arquivo sem trocar o arquivo (o proxy lê este mesmo arquivo).
  printf '\n%s {\n\tencode zstd gzip\n\treverse_proxy radarsonoro-app:3000\n\tlog {\n\t\toutput stdout\n\t\tformat json\n\t}\n}\n' "$DOMAIN" >> "$CF"
  if docker exec "$PROXY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    docker exec "$PROXY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
    echo "Configuração aplicada sem reiniciar o proxy. Cópia de segurança: $BACKUP"
  else
    cat "$BACKUP" > "$CF"
    warn "A configuração nova não passou na validação e foi desfeita. Os outros sites não foram afetados."
    docker exec "$PROXY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile || true
    exit 1
  fi
fi

IP="$(curl -fsS https://api.ipify.org || true)"
DNS="$(dig +short "$DOMAIN" A | tail -n1 || true)"
say "Pronto."
echo "IP deste servidor: ${IP:-desconhecido}"
if [ -n "$IP" ] && [ "$DNS" = "$IP" ]; then
  echo "O domínio $DOMAIN já aponta para cá. Abra https://$DOMAIN em alguns instantes."
else
  warn "O domínio $DOMAIN ainda não aponta para este servidor (aponta para: ${DNS:-nada})."
  echo "Crie um registro DNS tipo A com nome 'radarsonoro' e valor ${IP:-<IP do servidor>}."
  echo "Quando ele propagar, o certificado HTTPS sai sozinho; não precisa rodar nada de novo."
fi
echo "Para ver os registros: cd $DIR && docker compose logs -f app"
