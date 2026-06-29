# Docker Quick Reference

Quick commands and troubleshooting for Quantum Sport Backend.

## 🚀 Quick Start

```bash
# 1. Copy environment template
cp docker/env.production.template .env

# 2. Edit and set DB_PASSWORD, JWT_SECRET, etc.
nano .env

# 3. Deploy with automated script (recommended)
chmod +x scripts/deploy.sh
./scripts/deploy.sh

# OR deploy manually
DOCKER_BUILDKIT=1 docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d
```

## 📝 Common Commands

### Service Management

```bash
# Start all services
docker-compose -f docker-compose.prod.yml up -d

# Stop all services
docker-compose -f docker-compose.prod.yml down

# Restart specific service
docker-compose -f docker-compose.prod.yml restart app

# View status
docker-compose -f docker-compose.prod.yml ps
```

### Logs

```bash
# Follow all logs
docker-compose -f docker-compose.prod.yml logs -f

# Follow specific service
docker-compose -f docker-compose.prod.yml logs -f app

# Last 100 lines
docker-compose -f docker-compose.prod.yml logs --tail=100 app
```

### Database

```bash
# Database shell
docker-compose -f docker-compose.prod.yml exec db psql -U postgres quantum_sport

# Run migration
docker-compose -f docker-compose.prod.yml exec app bunx prisma migrate deploy

# Check migration status
docker-compose -f docker-compose.prod.yml exec app bunx prisma migrate status

# Backup database
docker-compose -f docker-compose.prod.yml exec db pg_dump -U postgres quantum_sport > backup.sql

# Restore database
docker-compose -f docker-compose.prod.yml exec -T db psql -U postgres quantum_sport < backup.sql
```

### Application Shell

```bash
# Access app container
docker-compose -f docker-compose.prod.yml exec app sh

# Run Prisma commands
docker-compose -f docker-compose.prod.yml exec app bunx prisma studio
```

## 🔧 Troubleshooting

### Issue: DB_PASSWORD not found

```bash
# Check .env exists
ls -la .env

# Verify DB_PASSWORD is set
grep DB_PASSWORD .env

# Restart services
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d
```

### Issue: Migration failed

```bash
# Clear failed migration
docker-compose -f docker-compose.prod.yml exec app sh -c \
  "echo \"UPDATE _prisma_migrations SET rolled_back_at = NOW() WHERE finished_at IS NULL;\" | bunx prisma db execute --stdin"

# Retry migration
docker-compose -f docker-compose.prod.yml exec app bunx prisma migrate deploy

# Restart app
docker-compose -f docker-compose.prod.yml restart app
```

### Issue: Port already in use

```bash
# Check what's using port 3000
sudo lsof -i :3000

# Stop system nginx if needed
sudo systemctl stop nginx

# OR change port in .env
echo "PORT=3001" >> .env
docker-compose -f docker-compose.prod.yml up -d
```

### Issue: Slow build

```bash
# Enable BuildKit
export DOCKER_BUILDKIT=1

# Build with cache
DOCKER_BUILDKIT=1 docker-compose -f docker-compose.prod.yml build --build-arg BUILDKIT_INLINE_CACHE=1

# Check if bun.lockb exists
ls -la bun.lockb
```

### Issue: Container keeps restarting

```bash
# Check logs for errors
docker-compose -f docker-compose.prod.yml logs --tail=100 app

# Check health
docker-compose -f docker-compose.prod.yml ps

# Inspect container
docker inspect quantum-sport-app-prod
```

## 🔍 Monitoring

```bash
# Resource usage
docker stats

# Disk usage
docker system df

# Health check
curl http://localhost:3000/health

# Database connection test
docker-compose -f docker-compose.prod.yml exec app bunx prisma db execute --stdin <<< "SELECT 1"
```

## 🧹 Cleanup

```bash
# Remove stopped containers
docker-compose -f docker-compose.prod.yml down

# Remove volumes (⚠️ deletes data!)
docker-compose -f docker-compose.prod.yml down -v

# Clean unused images
docker system prune -a

# Clean everything (⚠️ nuclear option)
docker system prune -a --volumes
```

## 📦 Updates

```bash
# Update code
git pull origin main

# Rebuild and restart
DOCKER_BUILDKIT=1 docker-compose -f docker-compose.prod.yml build app
docker-compose -f docker-compose.prod.yml up -d app

# Check if migration needed
docker-compose -f docker-compose.prod.yml exec app bunx prisma migrate status
```

## 🔐 Security

```bash
# Generate strong password (32 chars)
openssl rand -base64 32

# Check exposed ports
docker-compose -f docker-compose.prod.yml ps

# View environment (sanitized)
docker-compose -f docker-compose.prod.yml config
```

## 📊 Performance

```bash
# Check container stats
docker stats --no-stream

# Check database connections
docker-compose -f docker-compose.prod.yml exec db psql -U postgres -c \
  "SELECT count(*) FROM pg_stat_activity WHERE datname='quantum_sport';"

# Check Redis info
docker-compose -f docker-compose.prod.yml exec redis redis-cli INFO

# Check application metrics
curl http://localhost:3000/metrics
```

## 🎯 Development

```bash
# Use development compose file
docker-compose up -d

# Access Prisma Studio
docker-compose exec app bunx prisma studio
# Then visit http://localhost:5555

# Run tests in container
docker-compose exec app bun test

# Hot reload development
docker-compose up
```

## 💾 Backup & Restore

```bash
# Full backup
# Manual database backup (see DEPLOYMENT.md for full backup/restore guide)
docker-compose -f docker-compose.prod.yml exec db pg_dump \
  -U postgres -Fc quantum_sport > backup_$(date +%Y%m%d).dump

# Restore from backup
docker-compose -f docker-compose.prod.yml exec -T db pg_restore \
  -U postgres -d quantum_sport -c < backup_20250117.dump
```

## 🌐 Nginx Configuration

```bash
# Test nginx config
docker-compose -f docker-compose.prod.yml exec nginx nginx -t

# Reload nginx
docker-compose -f docker-compose.prod.yml exec nginx nginx -s reload

# View nginx logs
docker-compose -f docker-compose.prod.yml logs -f nginx
```

---

**For detailed documentation, see:** [DEPLOYMENT.md](./DEPLOYMENT.md)

