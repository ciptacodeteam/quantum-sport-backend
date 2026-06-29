# 🎯 Production Deployment Checklist

## Pre-Deployment

### 1. Environment Configuration

- [ ] Copy `docker/env.production.template` to `.env` (or keep your existing production `.env`)
- [ ] Set `NODE_ENV=production`
- [ ] Configure `BASE_URL` and `FRONT_END_URL` with production domains
- [ ] Set strong `DB_PASSWORD` (min 20 characters, alphanumeric + symbols)
- [ ] Set strong `JWT_SECRET` and `JWT_REFRESH_SECRET` (min 32 characters)
- [ ] Configure `XENDIT_API_KEY` with **LIVE** API key (not test)
- [ ] Set `XENDIT_CALLBACK_TOKEN` matching Xendit dashboard
- [ ] Configure SMTP credentials (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`)
- [ ] Set `PWD_PEPPER` (random 32+ character string)
- [ ] Configure `CORS_ORIGINS` with allowed domains
- [ ] Set `BLOB_READ_WRITE_TOKEN` if using Vercel Blob storage
- [ ] Review all environment variables for correctness

### 2. Infrastructure

- [ ] Server provisioned (min 2GB RAM, 2 CPU cores)
- [ ] Docker 20.10+ installed
- [ ] Docker Compose 2.0+ installed
- [ ] Git installed
- [ ] Domain name configured
- [ ] DNS records pointing to server
- [ ] Firewall configured (ports 80, 443, 22)
- [ ] SSH key authentication set up
- [ ] Non-root user with sudo access created

### 3. SSL/TLS

- [ ] SSL certificate obtained (Let's Encrypt recommended)
- [ ] Certificates copied to `docker/nginx/ssl/`
  - `cert.pem` (full chain)
  - `key.pem` (private key)
- [ ] Nginx SSL configuration uncommented in `default.conf`
- [ ] SSL renewal automation configured (certbot)
- [ ] HTTPS redirect enabled
- [ ] Test SSL configuration: https://www.ssllabs.com/ssltest/

### 4. Database

- [ ] Database backup strategy defined
- [ ] Backup storage location configured
- [ ] Backup retention policy set
- [ ] Restore procedure documented and tested
- [ ] Database connection limits reviewed
- [ ] PostgreSQL max_connections configured

### 5. Security

- [ ] All default passwords changed
- [ ] Redis password set (optional but recommended)
- [ ] Database only accessible from app container
- [ ] Firewall rules configured (deny all, allow specific)
- [ ] SSH password authentication disabled
- [ ] Fail2ban or similar brute-force protection
- [ ] Security headers configured in Nginx
- [ ] Rate limiting configured
- [ ] CORS properly configured

## Deployment

### 6. Initial Deployment

- [ ] Clone repository to server
  ```bash
  git clone <repo-url> /opt/quantum-sport-backend
  cd /opt/quantum-sport-backend
  ```
- [ ] Copy `.env` to server
- [ ] Make deploy script executable: `chmod +x scripts/deploy.sh`
- [ ] Review `docker-compose.prod.yml` settings
- [ ] Build images: `make prod-build`
- [ ] Start database and redis: `docker-compose -f docker-compose.prod.yml up -d db redis`
- [ ] Wait for services to be healthy (30 seconds)
- [ ] Run migrations: `make db-migrate`
- [ ] Seed database if needed: `docker-compose -f docker-compose.prod.yml exec app bunx prisma db seed`
- [ ] Start application: `make prod-up`
- [ ] Check all containers running: `docker-compose -f docker-compose.prod.yml ps`

### 7. Verification

- [ ] App health check: `curl http://localhost:3000/health`
- [ ] Database connectivity verified
- [ ] Redis connectivity verified
- [ ] Email sending tested
- [ ] Payment webhook endpoint accessible
- [ ] API endpoints responding
- [ ] Logs showing no errors: `make prod-logs`
- [ ] Memory usage acceptable: `docker stats`
- [ ] CPU usage acceptable

### 8. DNS & SSL

- [ ] HTTP accessible via domain (if SSL not ready)
- [ ] HTTPS accessible via domain
- [ ] SSL certificate valid
- [ ] HTTP redirects to HTTPS
- [ ] www redirects to non-www (or vice versa)
- [ ] Test from multiple locations

## Post-Deployment

### 9. Monitoring

- [ ] Container health checks working
- [ ] Application logs rotating properly
- [ ] Database logs accessible
- [ ] Disk space monitoring configured
- [ ] Memory monitoring configured
- [ ] CPU monitoring configured
- [ ] Alert system configured (optional)
- [ ] Uptime monitoring (optional: UptimeRobot, Pingdom)

### 10. Backup

- [ ] Initial database backup taken
- [ ] Backup cron job configured
- [ ] Backup restoration tested
- [ ] Volume backups configured
- [ ] Off-site backup configured (recommended)
- [ ] Backup monitoring/alerting

### 11. Documentation

- [ ] Deployment steps documented
- [ ] Access credentials stored securely (password manager)
- [ ] Runbook created for common issues
- [ ] Team trained on deployment process
- [ ] Emergency contact list updated
- [ ] Rollback procedure documented

### 12. Testing

- [ ] User registration flow tested
- [ ] Login flow tested
- [ ] Password reset tested
- [ ] Booking creation tested
- [ ] Payment flow tested (with test cards)
- [ ] Payment webhook tested
- [ ] Email notifications tested
- [ ] Admin functions tested
- [ ] Load testing performed (optional)

## CI/CD Setup (Optional)

### 13. GitHub Actions

- [ ] Repository secrets configured:
  - `DEPLOY_HOST`
  - `DEPLOY_USER`
  - `DEPLOY_SSH_KEY`
- [ ] Workflow tested on feature branch
- [ ] Auto-deployment on main branch enabled
- [ ] Notification on deployment failure
- [ ] Manual approval for production (optional)

## Ongoing Maintenance

### 14. Regular Tasks

- [ ] Weekly security updates: `docker-compose -f docker-compose.prod.yml pull`
- [ ] Monthly database backup verification
- [ ] Quarterly disaster recovery drill
- [ ] SSL certificate renewal (automated with certbot)
- [ ] Log review for errors/warnings
- [ ] Performance monitoring
- [ ] Disk space cleanup: `docker system prune -a`

### 15. Scaling Considerations

- [ ] Monitor resource usage trends
- [ ] Plan for horizontal scaling if needed
- [ ] Consider load balancer for multiple instances
- [ ] Database replication for read replicas
- [ ] CDN for static assets
- [ ] Redis cluster for high availability

## Emergency Procedures

### 16. Incident Response

- [ ] Emergency contacts documented
- [ ] Rollback procedure tested
- [ ] Database restore procedure tested
- [ ] Communication plan for outages
- [ ] Post-mortem template prepared

## Compliance

### 17. Legal & Compliance

- [ ] Privacy policy updated
- [ ] Terms of service updated
- [ ] GDPR compliance reviewed (if applicable)
- [ ] Data retention policy implemented
- [ ] Audit logging enabled
- [ ] Security incident response plan

## Optimization

### 18. Performance

- [ ] Database query optimization
- [ ] Index optimization
- [ ] Redis cache utilization
- [ ] Nginx caching configured
- [ ] Image optimization (if serving images)
- [ ] Compression enabled

## Final Verification

### 19. Launch Checklist

- [ ] All above items completed
- [ ] Stakeholders notified
- [ ] Team available for monitoring
- [ ] Rollback plan ready
- [ ] Support team briefed
- [ ] Documentation accessible
- [ ] Success criteria defined
- [ ] Launch announcement prepared

---

## Quick Commands Reference

### Start Services

```bash
./scripts/deploy.sh
# or
make prod-up
```

### View Logs

```bash
make prod-logs
```

### Restart Service

```bash
make prod-restart
```

### Database Backup

```bash
make db-backup
```

### Health Check

```bash
curl https://yourdomain.com/health
```

### Access Shell

```bash
make prod-shell
```

---

## Emergency Contacts

- **DevOps Lead**: [Name] - [Contact]
- **Backend Lead**: [Name] - [Contact]
- **Infrastructure**: [Provider Support]
- **Domain/DNS**: [Provider Support]
- **SSL Provider**: [Provider Support]

---

## Post-Deployment Success Metrics

Within 24 hours:

- [ ] Zero critical errors in logs
- [ ] All health checks passing
- [ ] Response time < 500ms (p95)
- [ ] Uptime > 99.9%
- [ ] No customer complaints
- [ ] Payment processing successful

Within 1 week:

- [ ] Performance baseline established
- [ ] No security incidents
- [ ] Backup/restore verified
- [ ] Team comfortable with operations
- [ ] Documentation complete and accurate

---

**Remember**: Always test in staging before production!

**Pro Tip**: Keep this checklist and check items off as you go. Better safe than sorry! 🚀
