# Radar Sonoro

Dashboard pessoal do seu gosto musical: intensidade e humor, vertentes, metas, selos e sugestões, a partir da sua conta do Spotify.

## Como funciona

- **Atualizar com Spotify:** o botão lê suas músicas curtidas, álbuns salvos e as faixas que você pôs nas suas playlists. Busca os gêneros dos artistas, completa energia, valência e BPM pelo ReccoBeats e redesenha a página.
- **Registro de escuta:** a cada 30 minutos o servidor guarda as últimas faixas que você tocou. É daí que vêm as metas de minutos escutados e de faixas reproduzidas, contadas a partir do dia da instalação.
- **Atualização automática:** a biblioteca também se atualiza sozinha uma vez por dia, às 5h.
- **Acesso:** só a conta do Spotify que fizer o primeiro login entra. Para trocar de dono, apague `data/owner.json`.

## Instalar ou atualizar no servidor

Rode como root:

```bash
curl -fsSL https://raw.githubusercontent.com/samvitor-git/radar-sonoro/main/install.sh | bash
```

O script instala o Docker se faltar, baixa o código e pede o Client Secret do Spotify na primeira vez (ele fica só no arquivo `/opt/radar-sonoro/.env`). Para atualizar, rode o mesmo comando: os dados e o `.env` são mantidos.

### Proxy

O app roda atrás do Caddy que já existe no servidor (`meu-dia-caddy-1`, rede `meu-dia_frontend`), com o nome `radarsonoro-app` nessa rede. Na instalação, o script acrescenta o bloco do domínio ao Caddyfile desse proxy. Antes, ele guarda uma cópia de segurança ao lado do arquivo. Se a configuração nova não passar na validação, ele desfaz a mudança. Se passar, recarrega o proxy sem reiniciar. Se uma publicação do meu-dia substituir o Caddyfile, rode o instalador de novo para religar o domínio. Para outro proxy, defina `PROXY_CONTAINER` e `PROXY_NETWORK` antes de rodar.

Num servidor sem proxy, use `docker-compose.standalone.yml`, que traz o próprio Caddy nas portas 80 e 443.

## Comandos úteis

```bash
cd /opt/radar-sonoro && docker compose logs -f app
```

```bash
cd /opt/radar-sonoro && docker compose restart
```

## Testar no próprio computador

```bash
DEMO_DATA=caminho/para/dados.json node server.js
```

No modo demonstração a página abre sem login, com os dados do arquivo.

## Ajustes

- Metas, cortes de humor e intensidade e regras dos selos ficam nos `dash.calc` de `public/index.html`.
- Artistas sem gênero no Spotify são classificados à mão em `lib/classify.js`.
- A lista de sugestões fica em `seed/recomendacoes.json`.
