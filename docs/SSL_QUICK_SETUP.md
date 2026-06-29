# SSL Quick Setup for api.quantumsocialclub.id

## ⚡ One-Command Setup

```bash
cd ~/quantum-sport-backend
git pull origin main
chmod +x scripts/setup-ssl.sh
./scripts/setup-ssl.sh
```

**Done!** Your API will be available at `https://api.quantumsocialclub.id`

## ✅ Before Running

Make sure:
1. DNS is configured (domain points to your server)
2. Ports 80 and 443 are open
3. No other service on port 80

**Verify DNS:**
```bash
dig +short api.quantumsocialclub.id
# Should return your server IP
```

**Open ports:**
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

## 🎯 What It Does

1. Verifies DNS configuration
2. Requests SSL certificate from Let's Encrypt
3. Configures nginx with HTTPS
4. Sets up auto-renewal (every 12 hours)
5. Tests HTTPS connection

## ⏱️ Expected Time

**2-3 minutes** for complete SSL setup

## 📝 After Setup

Your API endpoints:
- `https://api.quantumsocialclub.id/health`
- `https://api.quantumsocialclub.id/api/...`

HTTP automatically redirects to HTTPS ✅

## 🔄 Certificate Renewal

Automatic! Certbot runs every 12 hours with **webroot** mode: it writes challenge files to the shared volume and nginx serves them, so renewal works while nginx is running.

After a successful renewal, reload nginx to use the new certificate:

```bash
docker exec quantum-sport-nginx-prod nginx -s reload
```

(Optional: run this via a cron job after certbot, or use certbot’s `--deploy-hook` with Docker socket access to run the reload automatically.)

## 🆘 Certificate Expired (ERR_CERT_DATE_INVALID)

If the browser shows **ERR_CERT_DATE_INVALID** or “Your connection is not private”, the certificate is expired or invalid. Do this once:

1. **Redeploy** so certbot uses webroot for renewal (if you haven’t already):
   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   ```

2. **Renew the certificate** (webroot; nginx keeps serving):
   ```bash
   docker-compose -f docker-compose.prod.yml run --rm certbot renew --webroot --webroot-path=/var/www/certbot --force-renewal
   ```
   If you get “no certificate found”, obtain one first:
   ```bash
   docker-compose -f docker-compose.prod.yml run --rm certbot certonly --webroot --webroot-path=/var/www/certbot -d api.quantumsocialclub.id --email your@email.com --agree-tos --no-eff-email
   ```

3. **Reload nginx** to load the new cert:
   ```bash
   docker exec quantum-sport-nginx-prod nginx -s reload
   ```

4. Test: open `https://api.quantumsocialclub.id/health` in a browser.

## 🆘 If Setup Fails

```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs nginx
docker-compose -f docker-compose.prod.yml logs certbot

# Common fixes
dig +short api.quantumsocialclub.id  # Verify DNS
sudo netstat -tlnp | grep :80         # Check port 80
sudo ufw status                        # Check firewall

# Try again
./scripts/setup-ssl.sh
```

## 📚 Full Guide

See [DOMAIN_AND_SSL_SETUP.md](./DOMAIN_AND_SSL_SETUP.md) for complete documentation.

---

**Ready?** Run `./scripts/setup-ssl.sh` now! 🚀

