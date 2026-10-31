#!/usr/bin/env bash
# Installs Dawri on a fresh Ubuntu/Debian VPS: self-hosted Supabase + Dawri database,
# Edge Functions and web app, behind Caddy with automatic HTTPS.
#
#   curl -fsSL https://raw.githubusercontent.com/MohammadAlabdan/Claude-code/claude/new-session-kshbvu/dawri/deploy/vps/install.sh | sudo bash
#
# Options (environment variables):
#   DOMAIN=dawri.example.com   domain pointing at this server (default: the server's hostname)
#   SEED=0                     skip the three demo shops
#   ANTHROPIC_API_KEY=sk-...   enable the AI features (can be added later in /opt/dawri/dawri.env)
#
# Safe to run again: it updates the code, applies new migrations and keeps existing data and secrets.
set -euo pipefail

BASE=/opt/dawri
REPO=https://github.com/MohammadAlabdan/Claude-code
BRANCH=claude/new-session-kshbvu
SUPABASE_REF=self-hosted/v0.8.2
SUPABASE_SETUP=https://raw.githubusercontent.com/supabase/supabase/${SUPABASE_REF}/docker/setup.sh

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mxx %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" = 0 ] || die "Run as root (or with sudo)."
command -v apt-get >/dev/null || die "This script supports Ubuntu/Debian only."

DOMAIN=${DOMAIN:-$(hostname -f 2>/dev/null || hostname)}
case "$DOMAIN" in *.*) ;; *) die "Set DOMAIN=your.domain (got '$DOMAIN')." ;; esac
SEED=${SEED:-1}

say "Installing Dawri for https://$DOMAIN"
mkdir -p "$BASE"
cd "$BASE"

# Ports 80/443 must be free unless they are ours already.
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx supabase-caddy; then
  if command -v ss >/dev/null && ss -ltnH '( sport = :80 or sport = :443 )' | grep -q .; then
    ss -ltnp '( sport = :80 or sport = :443 )' || true
    die "Ports 80/443 are already used by another program (above). Stop it first, then run this again."
  fi
fi

say "Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates openssl jq >/dev/null

say "Downloading Dawri ($BRANCH)"
if [ -d src/.git ]; then
  git -C src fetch -q --depth 1 origin "$BRANCH" && git -C src reset -q --hard FETCH_HEAD
else
  git clone -q --depth 1 --branch "$BRANCH" "$REPO" src
fi
D="$BASE/src/dawri"

if [ ! -f supabase/.env ]; then
  say "Setting up Supabase ($SUPABASE_REF) — this installs Docker if needed and takes a few minutes"
  curl -fsSL "$SUPABASE_SETUP" -o /tmp/supabase-setup.sh
  sh /tmp/supabase-setup.sh -y --ref "$SUPABASE_REF" --project-dir supabase
else
  say "Supabase already set up; keeping its secrets"
fi
cd "$BASE/supabase"
[ -f docker-compose.caddy.yml ] || die "docker-compose.caddy.yml missing from the Supabase setup."

setenv() {
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*$|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
getenv() { grep "^$1=" .env | head -n1 | cut -d= -f2-; }

say "Configuring Supabase for $DOMAIN"
setenv SUPABASE_PUBLIC_URL "https://$DOMAIN"
setenv API_EXTERNAL_URL "https://$DOMAIN/auth/v1"
setenv SITE_URL "https://$DOMAIN"
setenv ADDITIONAL_REDIRECT_URLS "https://$DOMAIN/owner,https://$DOMAIN/start,https://$DOMAIN/admin"
setenv PROXY_DOMAIN "$DOMAIN"
# No mail server yet: accounts are confirmed immediately. No phone/SMS sign-in in Dawri.
setenv ENABLE_EMAIL_AUTOCONFIRM true
setenv ENABLE_PHONE_SIGNUP false
setenv ENABLE_PHONE_AUTOCONFIRM false
setenv FUNCTIONS_VERIFY_JWT false
setenv COMPOSE_FILE "docker-compose.yml:docker-compose.caddy.yml:docker-compose.dawri.yml"

if [ ! -f "$BASE/dawri.env" ]; then
  say "Generating Web Push (VAPID) keys"
  VAPID=$(docker run --rm node:22-alpine node -e '
    const c = require("crypto");
    const { privateKey } = c.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const j = privateKey.export({ format: "jwk" });
    const pub = Buffer.concat([Buffer.from([4]), Buffer.from(j.x, "base64url"), Buffer.from(j.y, "base64url")]).toString("base64url");
    console.log(pub + " " + j.d);')
  cat > "$BASE/dawri.env" <<EOF
# Dawri Edge Function secrets. Edit, then: cd $BASE/supabase && docker compose up -d functions
SITE_URL=https://$DOMAIN
VAPID_PUBLIC_KEY=${VAPID%% *}
VAPID_PRIVATE_KEY=${VAPID##* }
VAPID_SUBJECT=mailto:admin@$DOMAIN
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
ANTHROPIC_MODEL_FAST=claude-haiku-5-5
ANTHROPIC_MODEL_VISION=claude-sonnet-5-5
AI_DAILY_CAP=200
EOF
  chmod 600 "$BASE/dawri.env"
fi
sed -i "s|^SITE_URL=.*$|SITE_URL=https://$DOMAIN|" "$BASE/dawri.env"
VAPID_PUBLIC=$(grep '^VAPID_PUBLIC_KEY=' "$BASE/dawri.env" | cut -d= -f2-)

say "Installing Dawri's gateway config and Edge Functions"
cp "$D/deploy/vps/docker-compose.dawri.yml" .
mkdir -p volumes/proxy/dawri
cp "$D/deploy/vps/Caddyfile" volumes/proxy/dawri/Caddyfile
cp "$D/deploy/vps/functions-deno.jsonc" volumes/functions/deno.jsonc
for f in _shared customer staff owner onboard ai daily-summary maintenance admin; do
  rm -rf "volumes/functions/$f"
  cp -r "$D/supabase/functions/$f" "volumes/functions/$f"
done
rm -f volumes/functions/_shared/*_test.ts

say "Installing the web app (live mode)"
rm -rf "$BASE/web-live.new"
cp -r "$D/web" "$BASE/web-live.new"
cat > "$BASE/web-live.new/config.js" <<EOF
// Written by deploy/vps/install.sh
window.DAWRI_CONFIG = {
  SUPABASE_URL: "https://$DOMAIN",
  SUPABASE_ANON_KEY: "$(getenv ANON_KEY)",
  VAPID_PUBLIC_KEY: "$VAPID_PUBLIC",
  DEMO_MODE: false,
};
EOF
rm -rf "$BASE/web-live" && mv "$BASE/web-live.new" "$BASE/web-live"

say "Starting Supabase (first start pulls images, a few minutes)"
docker compose up -d --remove-orphans

wait_healthy() {
  local name=$1 i
  for i in $(seq 1 120); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$name" 2>/dev/null)" = healthy ] && return 0
    sleep 5
  done
  docker compose ps
  die "$name did not become healthy. Check: cd $BASE/supabase && docker compose logs ${name#supabase-}"
}
for c in supabase-db supabase-auth supabase-storage supabase-rest; do wait_healthy "$c"; done

PGPW=$(getenv POSTGRES_PASSWORD)
# supabase_admin is the superuser in Supabase's image (needed for storage policies and cron).
PGU=supabase_admin
docker compose exec -T -e PGPASSWORD="$PGPW" db psql -h 127.0.0.1 -U "$PGU" -d postgres -tAc 'select 1' >/dev/null 2>&1 || PGU=postgres
psql_admin() { docker compose exec -T -e PGPASSWORD="$PGPW" db psql -h 127.0.0.1 -U "$PGU" -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

say "Applying database migrations"
psql_admin -c "create table if not exists public._dawri_migrations (name text primary key, applied_at timestamptz default now())"
for m in "$D"/supabase/migrations/*.sql; do
  name=$(basename "$m")
  if [ "$(psql_admin -tAc "select 1 from public._dawri_migrations where name = '$name'")" = 1 ]; then continue; fi
  echo "   $name"
  psql_admin -f - < "$m"
  psql_admin -c "insert into public._dawri_migrations(name) values ('$name')"
done

say "Storing the API address for scheduled jobs (Vault)"
SRK=$(getenv SERVICE_ROLE_KEY)
psql_admin <<SQL
do \$\$ begin
  if exists (select 1 from pg_namespace where nspname = 'vault') then
    delete from vault.secrets where name in ('project_url', 'service_role_key');
    perform vault.create_secret('http://api-gw:8000', 'project_url');
    perform vault.create_secret('$SRK', 'service_role_key');
  end if;
end \$\$;
SQL

if [ "$SEED" = 1 ] && [ "$(psql_admin -tAc "select count(*) from public.businesses where is_demo")" = 0 ]; then
  say "Adding the three demo shops"
  psql_admin -f - < "$D/supabase/seed.sql"
fi

say "Restarting functions and the HTTPS proxy"
docker compose up -d --force-recreate functions caddy >/dev/null

sleep 10
NET=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' supabase-edge-functions)
# A fake ticket token must come back as "ticket_not_found" (404) from Dawri's customer function.
code=$(docker run --rm --network "$NET" curlimages/curl:8.10.1 -s -o /dev/null -w '%{http_code}' -X POST \
  http://api-gw:8000/functions/v1/customer -H "apikey: $(getenv ANON_KEY)" -H 'Content-Type: application/json' \
  -d '{"action":"ticket","token":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}' || true)
if [ "$code" = 404 ]; then echo "   Edge Functions answer correctly"; else warn "Edge Functions check returned HTTP $code (first start can be slow). See: cd $BASE/supabase && docker compose logs functions"; fi

cat <<EOF

========================================================================
 Dawri is running.

 App:            https://$DOMAIN
 Shops (demo):   https://$DOMAIN/s/aseel2026   /s/rukn2026   /s/lamaa2026
 Owner sign-in:  https://$DOMAIN/owner   (demo password: Dawri-Demo-2026)
                 barber@demo.dawri.app · cafe@demo.dawri.app · wash@demo.dawri.app · admin@demo.dawri.app
 Staff pairing:  https://$DOMAIN/staff/pair#demo-staff-aseel-chair1-000000000000
 New shop:       https://$DOMAIN/start

 Supabase Studio: https://$DOMAIN:8443
   user: $(getenv DASHBOARD_USERNAME)   password: $(getenv DASHBOARD_PASSWORD)

 Secrets:        $BASE/supabase/.env  and  $BASE/dawri.env   (keep them private)
 Update later:   run the same install command again.
========================================================================
EOF
