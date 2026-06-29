# Domain and SSL Setup Guide

Your domain **api.quantumsocialclub.id** is configured and ready! This guide will help you set up SSL certificates.

## 🌐 Domain Configuration

Your domain is already configured in the nginx configuration:
- **Domain:** `api.quantumsocialclub.id`
- **HTTP:** Port 80 (redirects to HTTPS)
- **HTTPS:** Port 443 (SSL)

## 🔐 SSL Certificate Setup (Let's Encrypt)

### Prerequisites

1. **DNS Must Be Configured** ✅
   - Your domain `api.quantumsocialclub.id` must point to your server IP
   - Verify with: `dig +short api.quantumsocialclub.id`

2. **Ports Must Be Open**
   ```bash
   # Check if ports are accessible
   sudo ufw status
   sudo ufw allow 80/tcp    # HTTP (for Let's Encrypt validation)
   sudo ufw allow 443/tcp   # HTTPS
   sudo ufw allow 22/tcp    # SSH
   ```

3. **No Other Service on Port 80**
   ```bash
   # Check what's using port 80
   sudo netstat -tlnp | grep :80
   
   # If system nginx is running, stop it
   sudo systemctl stop nginx
   sudo systemctl disable nginx
   ```

### Quick SSL Setup

Run the automated SSL setup script:

```bash
cd ~/quantum-sport-backend

# Make sure you're on the latest code
git pull origin main

# Make script executable
chmod +x scripts/setup-ssl.sh

# Run SSL setup
./scripts/setup-ssl.sh
```

The script will:
1. ✅ Verify DNS is pointing to your server
2. ✅ Request SSL certificate from Let's Encrypt
3. ✅ Install certificate in nginx
4. ✅ Set up auto-renewal (every 12 hours)
5. ✅ Test HTTPS connection

**Expected time:** 2-3 minutes

### Manual SSL Setup

If you prefer manual setup:

```bash
# 1. Start services without SSL
docker-compose -f docker-compose.prod.yml up -d db redis app nginx

# 2. Wait for services to be ready
sleep 10

# 3. Request certificate
docker-compose -f docker-compose.prod.yml run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email admin@quantumsocialclub.id \
  --agree-tos \
  --no-eff-email \
  -d api.quantumsocialclub.id

# 4. Restart nginx to use SSL
docker-compose -f docker-compose.prod.yml restart nginx

# 5. Verify HTTPS works
curl https://api.quantumsocialclub.id/health
```

## ✅ Verify SSL Is Working

```bash
# Test HTTPS endpoint
curl https://api.quantumsocialclub.id/health

# Check certificate details
echo | openssl s_client -connect api.quantumsocialclub.id:443 -servername api.quantumsocialclub.id 2>/dev/null | openssl x509 -noout -dates

# Check SSL grade (optional, from browser)
# https://www.ssllabs.com/ssltest/analyze.html?d=api.quantumsocialclub.id
```

Expected results:
- ✅ HTTPS endpoint responds with 200 OK
- ✅ Certificate is valid (not expired)
- ✅ Certificate is issued by Let's Encrypt
- ✅ HTTP redirects to HTTPS

## 🔄 Certificate Auto-Renewal

Certificates are automatically renewed every 12 hours (if needed).

**Check renewal status:**
```bash
# View certificate info
docker-compose -f docker-compose.prod.yml exec certbot certbot certificates

# Manually renew (if needed)
docker-compose -f docker-compose.prod.yml exec certbot certbot renew

# Test renewal without actually renewing
docker-compose -f docker-compose.prod.yml exec certbot certbot renew --dry-run
```

**Renewal happens automatically when:**
- Certificate is within 30 days of expiration
- Certbot container checks every 12 hours

## 🌍 Your API Endpoints

After SSL setup, your API will be available at:

### Public Endpoints
- **Health Check:** `https://api.quantumsocialclub.id/health`
- **API Base:** `https://api.quantumsocialclub.id/api/`
- **Webhooks:** `https://api.quantumsocialclub.id/webhooks/`

### Example Usage
```bash
# Health check
curl https://api.quantumsocialclub.id/health

# API endpoint example
curl https://api.quantumsocialclub.id/api/courts

# With authentication
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.quantumsocialclub.id/api/bookings
```

## 🔧 Configuration Files

The following files are configured for your domain:

### 1. Nginx Config
**File:** `docker/nginx/conf.d/default.conf`
- HTTP → HTTPS redirect
- SSL certificates configured
- Security headers enabled
- Rate limiting configured

### 2. Environment Variables
**File:** `.env`
```bash
APP_URL=https://api.quantumsocialclub.id
BASE_URL=https://api.quantumsocialclub.id
FRONTEND_URL=https://quantumsocialclub.id
SSL_EMAIL=admin@quantumsocialclub.id
```

### 3. Docker Compose
**File:** `docker-compose.prod.yml`
- Nginx service with SSL volumes
- Certbot service for auto-renewal
- Proper network configuration

## 🚨 Troubleshooting

### Issue: DNS not resolving

```bash
# Check DNS
dig +short api.quantumsocialclub.id

# Should return your server IP
# If not, wait for DNS propagation (can take up to 48 hours)
```

### Issue: Port 80 blocked

```bash
# Check firewall
sudo ufw status

# Allow ports
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Check if another service is using port 80
sudo netstat -tlnp | grep :80
```

### Issue: Certificate request failed

**Causes:**
1. DNS not pointing to server
2. Port 80 not accessible
3. Another service on port 80

**Solution:**
```bash
# 1. Verify DNS
dig +short api.quantumsocialclub.id

# 2. Check ports
sudo netstat -tlnp | grep :80
sudo netstat -tlnp | grep :443

# 3. Check nginx logs
docker-compose -f docker-compose.prod.yml logs nginx

# 4. Check certbot logs
docker-compose -f docker-compose.prod.yml logs certbot

# 5. Try again
./scripts/setup-ssl.sh
```

### Issue: "certificate not found" error

**Cause:** Nginx started before certificate was issued

**Solution:**
```bash
# Restart nginx after getting certificate
docker-compose -f docker-compose.prod.yml restart nginx

# Or restart all services
docker-compose -f docker-compose.prod.yml restart
```

### Issue: HTTPS works but HTTP doesn't redirect

**Cause:** Nginx configuration issue

**Solution:**
```bash
# Check nginx config
docker-compose -f docker-compose.prod.yml exec nginx nginx -t

# Reload nginx
docker-compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

## 📊 Security Headers

Your nginx is configured with these security headers:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
```

Test your security headers:
- https://securityheaders.com/?q=api.quantumsocialclub.id

## 🎯 Complete Setup Checklist

After SSL setup, verify everything:

- [ ] Domain resolves to correct IP: `dig +short api.quantumsocialclub.id`
- [ ] HTTP redirects to HTTPS: `curl -I http://api.quantumsocialclub.id`
- [ ] HTTPS works: `curl https://api.quantumsocialclub.id/health`
- [ ] Certificate is valid: Check expiry date
- [ ] Auto-renewal is configured: Check certbot logs
- [ ] All services are healthy: `docker-compose -f docker-compose.prod.yml ps`
- [ ] Frontend can connect to API
- [ ] Webhooks work (for payments, etc.)

## 📝 Update Your Frontend

Update your frontend configuration to use HTTPS:

```javascript
// frontend/.env
VITE_API_URL=https://api.quantumsocialclub.id
NEXT_PUBLIC_API_URL=https://api.quantumsocialclub.id
```

## 🔄 Deployment After SSL Setup

Future deployments will maintain SSL:

```bash
# Regular deployment
./scripts/deploy.sh

# SSL certificates are persisted in Docker volumes
# No need to reconfigure SSL on each deployment
```

## 📚 Additional Resources

- **Let's Encrypt Docs:** https://letsencrypt.org/docs/
- **Certbot Docs:** https://certbot.eff.org/docs/
- **Nginx SSL Config:** https://ssl-config.mozilla.org/

## 🆘 Need Help?

Common commands:

```bash
# Check certificate status
docker-compose -f docker-compose.prod.yml exec certbot certbot certificates

# Renew certificate manually
docker-compose -f docker-compose.prod.yml exec certbot certbot renew

# Check nginx logs
docker-compose -f docker-compose.prod.yml logs -f nginx

# Restart nginx
docker-compose -f docker-compose.prod.yml restart nginx

# Test nginx config
docker-compose -f docker-compose.prod.yml exec nginx nginx -t
```

---

**Ready?** Run `./scripts/setup-ssl.sh` to get SSL certificates! 🔐

