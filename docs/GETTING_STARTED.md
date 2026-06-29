# Getting Started with Production Deployment

## 🚀 Quick Start (5 Minutes)

### Step 1: Prepare Environment File

```bash
# Copy the template
cp docker/env.production.template .env
```

### Step 2: Edit Your Secrets

Open `.env` and set these **required** values:

```bash
# Database Password (use a strong password!)
DB_PASSWORD=your_super_secure_password_here

# JWT Secrets (minimum 32 characters each)
JWT_SECRET=your_jwt_secret_min_32_chars_here
JWT_REFRESH_SECRET=your_refresh_secret_min_32_chars_here

# Payment Gateway (Xendit)
XENDIT_SECRET_KEY=your_xendit_secret_key
XENDIT_WEBHOOK_TOKEN=your_xendit_webhook_token
XENDIT_PUBLIC_KEY=your_xendit_public_key

# Email Configuration
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=noreply@your-domain.com

# File Storage (Vercel Blob)
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token

# Frontend URL
FRONTEND_URL=https://your-frontend-domain.com
```

💡 **Tip:** Generate secure secrets with:
```bash
# On Linux/Mac
openssl rand -base64 32

# On Windows (PowerShell)
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
```

### Step 3: Deploy

**Option A: Automated Deployment (Recommended)**
```bash
# Make script executable (first time only)
chmod +x scripts/deploy.sh

# Run deployment
./scripts/deploy.sh
```

The script will automatically:
- ✅ Validate environment variables
- ✅ Pull latest code
- ✅ Build optimized Docker images
- ✅ Start all services
- ✅ Run database migrations
- ✅ Verify deployment health

**Option B: Manual Deployment**
```bash
# Build images
DOCKER_BUILDKIT=1 docker-compose -f docker-compose.prod.yml build

# Start services
docker-compose -f docker-compose.prod.yml up -d

# Check status
docker-compose -f docker-compose.prod.yml ps
```

### Step 4: Verify

```bash
# Check all services are running
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f app

# Test health endpoint
curl http://localhost:3000/health
```

## ✅ Success Indicators

You should see:
- ✅ All containers showing "Up (healthy)"
- ✅ App logs showing "🚀 Starting application..."
- ✅ Migrations completed successfully
- ✅ Health endpoint returns 200 OK

## ❌ Common Issues

### "DB_PASSWORD is required"
**Cause:** Password contains `$` or other characters Docker Compose misreads from `.env`.

**Solution:** Quote it — `DB_PASSWORD='a1ndi$'` — or use `scripts/deploy.sh` / `scripts/deploy-registry.sh`, which handle this automatically.

### "port 80 is already allocated"
**Solution:** Either stop system nginx (`sudo systemctl stop nginx`) or change the port in `.env` (`PORT=3001`).

### Migration fails
**Solution:** The migrations are now idempotent. If you see errors, try:
```bash
docker-compose -f docker-compose.prod.yml restart app
```

## 📚 Documentation

- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Complete guide
- **[DOCKER_QUICK_REFERENCE.md](./DOCKER_QUICK_REFERENCE.md)** - Quick commands
- **[DEPLOY_SCRIPT_GUIDE.md](./DEPLOY_SCRIPT_GUIDE.md)** - Production deploy script

## 🎯 Next Steps

1. **SSL/TLS:** Configure HTTPS with Let's Encrypt
2. **Backups:** Set up automated database backups
3. **Monitoring:** Set up logging and alerting
4. **Firewall:** Configure firewall rules (only expose 80, 443, SSH)
5. **Domain:** Point your domain to the server

## 🆘 Need Help?

Check logs:
```bash
docker-compose -f docker-compose.prod.yml logs -f app
```

Check database:
```bash
docker-compose -f docker-compose.prod.yml exec app bunx prisma migrate status
```

Access app shell:
```bash
docker-compose -f docker-compose.prod.yml exec app sh
```

---

**Ready to deploy?** Start with Step 1 above! 🚀

