# Deploy Script Guide

Complete guide for using the `./scripts/deploy.sh` script for production deployment.

## 🎯 Overview

The `deploy.sh` script is your one-command solution for deploying the Quantum Sport Backend to production. It handles everything from environment validation to health checks.

## 🚀 Quick Start

```bash
# 1. First time: Set up environment
cp docker/env.production.template .env
nano .env  # Edit and set your secrets

# 2. Make script executable (first time only)
chmod +x scripts/deploy.sh

# 3. Deploy!
./scripts/deploy.sh
```

That's it! The script handles everything else automatically.

## ✨ What the Script Does

When you run `./scripts/deploy.sh`, it automatically:

### 1. **Pre-flight Checks** ✈️
- ✅ Verifies Docker and Docker Compose are installed
- ✅ Checks if running as root (warns if so)
- ✅ Validates `.env` exists
- ✅ Checks for required environment variables:
  - `DB_PASSWORD`
  - `JWT_SECRET`
  - `JWT_REFRESH_SECRET`

### 2. **Deployment Confirmation** ⚠️
- Asks for confirmation before deploying
- Type `yes` to proceed

### 3. **Code Update** 📥
- Pulls latest code from git (`main` branch)
- Continues if git pull fails (useful for local changes)

### 4. **Build Process** 🏗️
- Builds Docker images with BuildKit optimization
- Uses cache by default (faster)
- Set `CLEAN_BUILD=true` for clean build

### 5. **Service Startup** 🚀
- Starts all services (database, Redis, app, workers, nginx)
- Database migrations run automatically via entrypoint script
- Services start in correct order with health checks

### 6. **Health Verification** 🏥
- Waits for services to become healthy
- Checks application health status
- Verifies database migration status
- Shows recent application logs

### 7. **Post-Deployment** ✅
- Displays service status
- Shows helpful commands
- Confirms successful deployment

## 📋 Environment Variables

### Required Variables

These **must** be set in `.env`:

```bash
# Database Password (use a strong password!)
DB_PASSWORD=your_super_secure_password_here

# JWT Secrets (minimum 32 characters each)
JWT_SECRET=your_jwt_secret_min_32_chars_here
JWT_REFRESH_SECRET=your_refresh_secret_min_32_chars_here
```

### Generate Secure Secrets

```bash
# On Linux/Mac
openssl rand -base64 32

# On Windows PowerShell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
```

### Other Important Variables

See `docker/env.production.template` for complete list:
- Payment gateway credentials (Xendit)
- Email configuration (SMTP)
- File storage (Vercel Blob)
- Frontend URL (CORS)

## 🎛️ Advanced Usage

### Clean Build

Force a clean build without cache:

```bash
CLEAN_BUILD=true ./scripts/deploy.sh
```

### Skip Git Pull

If you don't want to pull latest code:

```bash
# Temporarily rename .git directory
mv .git .git.bak
./scripts/deploy.sh
mv .git.bak .git
```

Or edit the script to comment out the git pull section.

## 🔍 Understanding the Output

### Successful Deployment

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Quantum Sport Backend - Production Deployment
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ℹ️  Validating environment configuration...
✅ Environment configuration validated

⚠️  This will deploy to PRODUCTION environment
Are you sure you want to continue? (yes/no): yes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Pulling Latest Code
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ℹ️  Fetching latest changes from repository...
✅ Code updated successfully

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Building Docker Images
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ℹ️  Building with cache for faster builds...
✅ Build completed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Starting Services
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ℹ️  Starting database, Redis, application, and workers...
✅ All services started

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Deployment Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NAME                              STATUS     PORTS
quantum-sport-app-prod            Up (healthy)
quantum-sport-db-prod             Up (healthy)
quantum-sport-redis-prod          Up (healthy)
quantum-sport-email-worker-prod   Up

✅ Application is healthy
✅ Database migrations are up to date

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Deployment Complete!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ All services are running

ℹ️  Useful commands:

  📋 View logs:
     docker compose -f docker-compose.prod.yml logs -f app

  🔄 Restart service:
     docker compose -f docker-compose.prod.yml restart app

  🛑 Stop services:
     docker compose -f docker-compose.prod.yml down

✅ Deployment completed successfully! 🚀
```

## ❌ Common Errors

### Error: .env not found

**Problem:** Environment file doesn't exist

**Solution:**
```bash
cp docker/env.production.template .env
nano .env  # Edit and set your secrets
./scripts/deploy.sh
```

### Error: Missing required variables

**Problem:** Required environment variables not set or have placeholder values

**Output:**
```
❌ Missing or invalid required variables in .env:
  - DB_PASSWORD
  - JWT_SECRET
```

**Solution:**
```bash
nano .env
# Set actual values for DB_PASSWORD and JWT_SECRET
./scripts/deploy.sh
```

### Error: Build failed

**Problem:** Docker build encountered an error

**Solution:**
```bash
# Try clean build
CLEAN_BUILD=true ./scripts/deploy.sh

# Or check Docker is running
docker ps

# Check disk space
df -h
```

### Error: Application not healthy

**Problem:** App container started but health check fails

**Solution:**
```bash
# Check logs
docker compose -f docker-compose.prod.yml logs -f app

# Common causes:
# - Database connection failed (check DB_PASSWORD)
# - Migration failed (check logs for SQL errors)
# - Port already in use (check PORT in .env)
```

## 🔧 Troubleshooting Commands

### Check Status
```bash
docker compose -f docker-compose.prod.yml ps
```

### View Logs
```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml logs -f db
```

### Check Migrations
```bash
docker compose -f docker-compose.prod.yml exec app bunx prisma migrate status
```

### Test Database Connection
```bash
docker compose -f docker-compose.prod.yml exec app bunx prisma db execute --stdin <<< "SELECT 1"
```

### Access Container Shell
```bash
docker compose -f docker-compose.prod.yml exec app sh
```

### Restart Services
```bash
# Restart app only
docker compose -f docker-compose.prod.yml restart app

# Restart all
docker compose -f docker-compose.prod.yml restart
```

## 📚 Related Documentation

- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Complete deployment guide
- **[DOCKER_QUICK_REFERENCE.md](./DOCKER_QUICK_REFERENCE.md)** - Quick command reference
- **[GETTING_STARTED.md](./GETTING_STARTED.md)** - 5-minute quick start
- **[docker/env.production.template](./docker/env.production.template)** - Environment template

## 🎓 Tips & Best Practices

1. **Always Review Logs**: After deployment, check logs for any warnings
   ```bash
   docker compose -f docker-compose.prod.yml logs -f app
   ```

2. **Test Before Production**: Test in a staging environment first

3. **Backup Database**: Before major updates, backup your database
   ```bash
   docker compose -f docker-compose.prod.yml exec db pg_dump -U postgres quantum_sport > backup.sql
   ```

4. **Use Strong Passwords**: Generate secure passwords for DB_PASSWORD and JWT secrets

5. **Monitor Resources**: Check CPU and memory usage
   ```bash
   docker stats
   ```

6. **Regular Updates**: Keep Docker images updated
   ```bash
   docker compose -f docker-compose.prod.yml pull
   ./scripts/deploy.sh
   ```

## 🆘 Getting Help

If the deployment fails:

1. Check the error message carefully
2. Review logs: `docker compose -f docker-compose.prod.yml logs -f`
3. Verify environment variables are set correctly
4. Check database connectivity
5. Review migration status
6. Consult the [DEPLOYMENT.md](./DEPLOYMENT.md)

## ✅ Success Checklist

After running `./scripts/deploy.sh`, verify:

- [ ] All containers show "Up (healthy)" status
- [ ] Application logs show no errors
- [ ] Database migrations completed successfully
- [ ] Health endpoint responds: `curl http://localhost:3000/health`
- [ ] Frontend can connect to backend
- [ ] Email worker is processing jobs (if configured)

---

**Ready to deploy?** Run `./scripts/deploy.sh` and watch the magic happen! 🚀

