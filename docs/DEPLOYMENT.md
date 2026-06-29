# Production Deployment Guide

Complete guide for deploying Quantum Sport Backend with Docker in production.

**Related docs:**
- [DEPLOY_SCRIPT_GUIDE.md](./DEPLOY_SCRIPT_GUIDE.md) — `./scripts/deploy.sh` in detail
- [DOCKER_QUICK_REFERENCE.md](./DOCKER_QUICK_REFERENCE.md) — command cheat sheet
- [SSL_QUICK_SETUP.md](./SSL_QUICK_SETUP.md) / [DOMAIN_AND_SSL_SETUP.md](./DOMAIN_AND_SSL_SETUP.md) — HTTPS setup
- [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md) — pre-launch checklist
- [GETTING_STARTED.md](./GETTING_STARTED.md) — 5-minute quick start

## Prerequisites

- Docker Engine 20.10+ and Docker Compose 2.0+
- Git
- Ubuntu/Debian server (or similar Linux)
- Domain name with DNS pointed at your server (for HTTPS)
- **Recommended:** 4GB RAM, 2 CPU cores, 10GB disk
- **Minimum:** 2GB RAM (add swap; builds will be slower)

## Architecture

```
┌─────────────┐
│   Nginx     │ :80/:443 (reverse proxy + SSL)
└─────┬───────┘
      │
┌─────▼───────┐
│     App     │ :8000 (Bun backend)
└─────┬───────┘
      │
┌─────▼───────┬─────────────┐
│ PostgreSQL  │    Redis    │
│   :5432     │    :6379    │
└─────────────┴─────────────┘
```

### Services

| Service | Purpose | Notes |
|---------|---------|-------|
| **db** | PostgreSQL 16 | Volume `postgres_data`, health checks |
| **redis** | Cache & job queue | AOF persistence via `docker/redis.conf` |
| **app** | Main API | Multi-stage build, non-root user |
| **email-worker** | Background email jobs | Connects to Redis queue |
| **nginx** | Reverse proxy | SSL termination, rate limiting |
| **certbot** | SSL certificates | Let's Encrypt auto-renewal |

## Quick Start

### 1. Clone and configure

```bash
git clone <repository-url>
cd quantum-sport-backend
cp docker/env.production.template .env
nano .env
```

**Required variables:**

```bash
DB_PASSWORD=your_super_secure_password_here
JWT_SECRET=your_jwt_secret_min_32_chars_here
JWT_REFRESH_SECRET=your_refresh_secret_min_32_chars_here
```

Also configure payment (`XENDIT_API_KEY`), email (`SMTP_*`), and URLs (`BASE_URL`, `FRONT_END_URL`) before going live. See `docker/env.production.template` for the full list.

Production on the VPS uses **`.env`** in the project root (not `.env.production`). Override with `ENV_FILE` if needed.

### 2. Deploy

**Automated (recommended):**

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

The script validates env vars, pulls latest code, builds images, runs migrations, starts services, and checks health.

**Manual:**

```bash
DOCKER_BUILDKIT=1 docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d
docker-compose -f docker-compose.prod.yml exec app bunx prisma migrate deploy
```

### 3. Verify

```bash
docker-compose -f docker-compose.prod.yml ps          # all services "Up (healthy)"
curl http://localhost:8000/health                      # health check
docker-compose -f docker-compose.prod.yml logs --tail=50 app
```

### 4. SSL (production domain)

```bash
chmod +x scripts/setup-ssl.sh
./scripts/setup-ssl.sh
```

See [SSL_QUICK_SETUP.md](./SSL_QUICK_SETUP.md) for details.

## Server Sizing

### 4GB RAM (recommended)

Optimal for production booking workloads — fast builds (3–5 min), no swap needed, handles 200–300 concurrent users comfortably.

| Service | Memory | CPU |
|---------|--------|-----|
| PostgreSQL | ~600MB | 0.5 |
| Redis | ~128MB | 0.5 |
| Application | ~2GB | 2.0 |
| Email worker | ~1GB | 1.0 |
| System + buffer | ~1.3GB | — |

Normal memory usage: 60–75% at rest, up to ~88% during peak traffic.

### 2GB RAM (minimum)

Add swap before deploying:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Expect slower builds (10–15 min) and tighter headroom. Upgrade to 4GB when memory consistently exceeds 85%.

### Upgrading from 2GB to 4GB

```bash
sudo swapoff /swapfile 2>/dev/null || true
sudo rm /swapfile 2>/dev/null || true
sudo sed -i '/swapfile/d' /etc/fstab
docker system prune -a -f --volumes
git pull origin main
./scripts/deploy.sh
```

## Security

- Multi-stage Docker builds (~200MB images, no dev deps)
- Non-root container user, read-only root filesystem
- Resource limits and health checks in `docker-compose.prod.yml`
- Nginx rate limiting and security headers
- Network isolation between services

**Best practices:**

1. Never commit `.env`
2. Use strong passwords (16+ chars for `DB_PASSWORD`)
3. Expose only ports 80, 443, and SSH via firewall
4. Keep Docker images and dependencies updated
5. Schedule regular database backups

## Common Operations

### Logs

```bash
docker-compose -f docker-compose.prod.yml logs -f              # all services
docker-compose -f docker-compose.prod.yml logs -f app          # app only
docker-compose -f docker-compose.prod.yml logs --tail=100 app  # last 100 lines
```

### Restart and update

```bash
# Restart a service
docker-compose -f docker-compose.prod.yml restart app

# Update application
git pull origin main
./scripts/deploy.sh

# Or manual rebuild
DOCKER_BUILDKIT=1 docker-compose -f docker-compose.prod.yml build app
docker-compose -f docker-compose.prod.yml up -d app
```

### Database

```bash
# Migrations
docker-compose -f docker-compose.prod.yml exec app bunx prisma migrate deploy
docker-compose -f docker-compose.prod.yml exec app bunx prisma migrate status

# Shell
docker-compose -f docker-compose.prod.yml exec db psql -U postgres quantum_sport

# Backup
docker-compose -f docker-compose.prod.yml exec db pg_dump -U postgres -Fc quantum_sport > backup_$(date +%Y%m%d).dump

# Restore
docker-compose -f docker-compose.prod.yml exec -T db pg_restore -U postgres -d quantum_sport -c < backup.dump
```

### Shell access

```bash
docker-compose -f docker-compose.prod.yml exec app sh
```

### Scale (zero-downtime updates)

```bash
docker-compose -f docker-compose.prod.yml up -d --scale app=2 --no-recreate
sleep 30
docker-compose -f docker-compose.prod.yml up -d --scale app=1
```

## Monitoring

```bash
free -h                                                        # host memory
docker stats                                                   # per-container usage
docker-compose -f docker-compose.prod.yml ps                     # health status
curl http://localhost:8000/health                              # app health
docker system df                                               # disk usage
```

### Maintenance schedule

```bash
# Weekly: prune unused Docker data
docker system prune -f

# Monthly: database maintenance
docker-compose -f docker-compose.prod.yml exec db psql -U postgres quantum_sport -c "VACUUM ANALYZE;"
```

## Troubleshooting

### DB_PASSWORD is required (password contains `$`, `!`, etc.)

Docker Compose treats `$` in `.env` as variable syntax, so `DB_PASSWORD=a1ndi$` looks empty to Compose.

**Fix (either works):**
1. Quote the value in `.env`: `DB_PASSWORD='a1ndi$'`
2. Use the deploy scripts (`scripts/deploy.sh` / `scripts/deploy-registry.sh`) — they export credentials safely before Compose runs.

If you set `DATABASE_URL` manually, URL-encode special characters (`$` → `%24`).

### Migration failures

```bash
docker-compose -f docker-compose.prod.yml exec app bunx prisma migrate status

# Mark failed migrations as rolled back, then retry
docker-compose -f docker-compose.prod.yml exec app sh -c \
  "echo \"UPDATE _prisma_migrations SET rolled_back_at = NOW() WHERE finished_at IS NULL;\" | bunx prisma db execute --stdin"
docker-compose -f docker-compose.prod.yml exec app bunx prisma migrate deploy
docker-compose -f docker-compose.prod.yml restart app
```

See [docs/MIGRATION_RECOVERY.md](./docs/MIGRATION_RECOVERY.md) for advanced recovery.

### Port already in use

```bash
sudo lsof -i :80
sudo systemctl stop nginx   # if system nginx conflicts
```

### Slow builds

```bash
export DOCKER_BUILDKIT=1
docker system prune -a -f
CLEAN_BUILD=true ./scripts/deploy.sh
```

### Container won't start

```bash
docker-compose -f docker-compose.prod.yml logs app
docker-compose -f docker-compose.prod.yml build --no-cache
```

### High memory usage (>90%)

```bash
docker stats --no-stream
docker-compose -f docker-compose.prod.yml restart app
```

### Database connection issues

```bash
docker-compose -f docker-compose.prod.yml ps db
docker-compose -f docker-compose.prod.yml exec db psql -U postgres -c "SELECT 1"
docker-compose -f docker-compose.prod.yml exec app env | grep DATABASE_URL
```

## CI/CD (GitHub Actions → GHCR → VPS)

Pushes to `main` run `.github/workflows/docker-production.yml`:

1. **test** — lint, typecheck, unit tests
2. **build-and-deploy** — build image on GitHub runners, push to GHCR, SSH to VPS and run `scripts/deploy-registry.sh` (pull + restart, no build on the droplet)

Image: `ghcr.io/<github-owner>/quantum-sport-backend:<commit-sha>`

### GitHub repository secrets

| Secret | Example | Purpose |
|--------|---------|---------|
| `DO_HOST` | `123.45.67.89` | VPS IP or hostname |
| `DO_SSH_PORT` | `22` | SSH port |
| `DO_USERNAME` | `deploy` | SSH user |
| `DO_PROJECT_PATH` | `/home/deploy/quantum-sport-backend` | Repo path on VPS |
| `DO_SSH_PRIVATE_KEY` | `-----BEGIN OPENSSH PRIVATE KEY-----...` | Deploy key (or use B64 variant) |
| `DO_SSH_PRIVATE_KEY_B64` | *(optional)* | Base64-encoded key (easier on Windows) |

`GITHUB_TOKEN` is provided automatically for GHCR push/pull during the workflow.

### One-time VPS setup

```bash
# Clone repo and configure env (first deploy only)
git clone <repo-url> ~/quantum-sport-backend
cd ~/quantum-sport-backend
cp docker/env.production.template .env
nano .env   # set DB_PASSWORD, JWT_SECRET, etc.

# Start infrastructure once (builds locally on first run)
chmod +x scripts/*.sh
./scripts/deploy.sh

# Or bring up db/redis/nginx only, then let CI deploy the app image
docker compose -f docker-compose.prod.yml up -d db redis nginx certbot
```

Add the GitHub Actions deploy public key to `~/.ssh/authorized_keys` on the VPS.

### Manual registry deploy (same as CI)

```bash
export APP_IMAGE=ghcr.io/<owner>/quantum-sport-backend:<sha>
docker login ghcr.io -u <github-user>
bash scripts/deploy-registry.sh
```

## Production Checklist

- [ ] GitHub Actions secrets configured (`DO_HOST`, `DO_SSH_*`, `DO_PROJECT_PATH`)
- [ ] `.env` configured with all required variables
- [ ] Strong passwords for `DB_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`
- [ ] SSL configured (`./scripts/setup-ssl.sh`)
- [ ] Firewall: only 80, 443, SSH exposed
- [ ] All services show "Up (healthy)"
- [ ] Database migrations completed
- [ ] Database backups scheduled
- [ ] End-to-end booking and payment flow tested
- [ ] Email notifications working

## Capacity Planning

**4GB handles comfortably:**
- 200–300 concurrent users
- 1000+ bookings/day
- Real-time payment processing

**Consider 8GB when:**
- 500+ concurrent users regularly
- Memory consistently above 85%
- 3000+ bookings/day

## Cleanup

```bash
docker-compose -f docker-compose.prod.yml down          # stop services
docker-compose -f docker-compose.prod.yml down -v       # ⚠️ also deletes volumes
docker system prune -a                                  # remove unused images
docker system prune -a --volumes                        # ⚠️ nuclear option
```
