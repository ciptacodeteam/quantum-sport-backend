# Prisma Studio in Production

This guide shows you how to connect to Prisma Studio for your production database.

## Quick Start

### Start Prisma Studio

```bash
# Start Prisma Studio service
docker-compose -f docker-compose.prod.yml up -d prisma-studio

# Check if it's running
docker-compose -f docker-compose.prod.yml ps prisma-studio

# View logs
docker-compose -f docker-compose.prod.yml logs -f prisma-studio
```

### Access Prisma Studio

- **Local access:** `http://localhost:5555`
- **Remote access:** `http://your-server-ip:5555`

### Stop Prisma Studio

```bash
# Stop the service
docker-compose -f docker-compose.prod.yml stop prisma-studio

# Stop and remove container
docker-compose -f docker-compose.prod.yml down prisma-studio
```

## Security Considerations

⚠️ **Important:** Prisma Studio provides full database access. Use with caution in production!

### Recommended Security Measures

1. **Firewall Rules**
   - Restrict port 5555 to specific IP addresses
   - Only allow access from trusted networks

2. **Nginx Reverse Proxy** (Recommended)
   - Add authentication (Basic Auth or OAuth)
   - Use HTTPS
   - Restrict by IP

3. **SSH Tunnel** (Most Secure)
   ```bash
   # Create SSH tunnel from your local machine
   ssh -L 5555:localhost:5555 user@your-server-ip
   
   # Then access via http://localhost:5555
   ```

4. **Start Only When Needed**
   - The service is set to `restart: "no"` so it won't auto-start
   - Always stop it when you're done

## Configuration

### Port Configuration

You can change the port by setting `PRISMA_STUDIO_PORT` in `.env`:

```bash
PRISMA_STUDIO_PORT=5555
```

### Environment Variables

Prisma Studio uses the same `.env` file and connects to the production database automatically.

## Troubleshooting

### Prisma Studio won't start

1. **Check database connection:**
   ```bash
   docker-compose -f docker-compose.prod.yml exec db pg_isready -U postgres
   ```

2. **Check logs:**
   ```bash
   docker-compose -f docker-compose.prod.yml logs prisma-studio
   ```

3. **Verify DATABASE_URL:**
   ```bash
   docker-compose -f docker-compose.prod.yml exec prisma-studio env | grep DATABASE_URL
   ```

### Can't access from remote

1. **Check if port is exposed:**
   ```bash
   docker-compose -f docker-compose.prod.yml ps prisma-studio
   # Should show 0.0.0.0:5555->5555/tcp
   ```

2. **Check firewall:**
   ```bash
   # On Ubuntu/Debian
   sudo ufw status
   sudo ufw allow 5555/tcp  # Only if needed
   ```

3. **Check if service is running:**
   ```bash
   docker-compose -f docker-compose.prod.yml ps prisma-studio
   ```

### Connection refused

- Ensure the database service is healthy
- Check that Prisma Studio container is on the same network
- Verify DATABASE_URL format in `.env`

## Alternative: Run Locally

If you prefer to run Prisma Studio locally and connect to the remote database:

### Option 1: SSH Tunnel + Local Prisma Studio

```bash
# 1. Create SSH tunnel to database
ssh -L 5432:localhost:5432 user@your-server-ip

# 2. In another terminal, set DATABASE_URL to use localhost
export DATABASE_URL="postgresql://postgres:password@localhost:5432/quantum_sport"

# 3. Run Prisma Studio locally
bunx prisma studio
```

### Option 2: Direct Connection (if database port is exposed)

```bash
# Set DATABASE_URL to your server's database
export DATABASE_URL="postgresql://postgres:password@your-server-ip:5432/quantum_sport"

# Run Prisma Studio
bunx prisma studio
```

⚠️ **Warning:** Only use direct connection if database is properly secured with firewall rules!

## Best Practices

1. ✅ **Start only when needed** - Don't leave it running 24/7
2. ✅ **Use SSH tunnel** for remote access
3. ✅ **Restrict access** via firewall or nginx
4. ✅ **Use strong database passwords**
5. ✅ **Monitor logs** for suspicious activity
6. ✅ **Stop immediately** after use

## Quick Reference

```bash
# Start
docker-compose -f docker-compose.prod.yml up -d prisma-studio

# Stop
docker-compose -f docker-compose.prod.yml stop prisma-studio

# Logs
docker-compose -f docker-compose.prod.yml logs -f prisma-studio

# Restart
docker-compose -f docker-compose.prod.yml restart prisma-studio

# Remove
docker-compose -f docker-compose.prod.yml down prisma-studio
```

