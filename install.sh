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

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  say "Liberando as portas 80 e 443 no firewall"
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi

for svc in apache2 nginx; do
  if systemctl is-active --quiet "$svc" 2>/dev/null; then
    warn "O serviço $svc está usando as portas 80/443. Vou pará-lo para o Radar Sonoro funcionar."
    systemctl disable --now "$svc"
  fi
done

say "Subindo a aplicação"
docker compose down --remove-orphans >/dev/null 2>&1 || true
docker compose up -d --build

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
