# Quantum Sport Backend

This project is a backend API built with [Hono](https://hono.dev/) for Quantum Sport. You can set up and run the API using either **npm**, **bun**, or **Docker**.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
  - [Local Development](#local-development)
  - [Docker Development](#docker-development)
- [Production Deployment](#production-deployment)
- [Development Guide](./docs/develop-guide.md)
- [Production Deployment](./docs/DEPLOYMENT.md)
- [Scripts](#scripts)
- [Learn More](#learn-more)

## Prerequisites

### Local Development
- [Node.js](https://nodejs.org/) (v18+ recommended) or [Bun](https://bun.sh/)
- [PostgreSQL](https://www.postgresql.org/) 16+
- [Redis](https://redis.io/) 7+
- [Git](https://git-scm.com/)

### Docker Development/Production
- [Docker](https://www.docker.com/) 20.10+
- [Docker Compose](https://docs.docker.com/compose/) 2.0+
- [Git](https://git-scm.com/)

## Getting Started

### Local Development

#### 1. Clone the Repository

```bash
git clone https://github.com/ciptacodeteam/quantum-sport-backend.git
cd quantum-sport-backend
```

#### 2. Install Dependencies

Using npm:
```bash
npm install
```

Using Bun:
```bash
bun install
```

#### 3. Configure Environment Variables

```bash
cp .env.example .env
# Edit .env with your configuration
```

#### 4. Setup Database

```bash
# Push schema to database
bun run db:push

# Or run migrations
bun run prisma:migrate
```

#### 5. Run the Development Server

```bash
bun dev
```

The API will be available at `http://localhost:3000`.

---

### Docker Development

#### 1. Clone and Configure

```bash
git clone https://github.com/ciptacodeteam/quantum-sport-backend.git
cd quantum-sport-backend
cp .env.example .env.local
# Edit .env.local with your configuration
```

#### 2. Start Services

```bash
# Start all services (app, database, redis, prisma studio)
docker-compose up -d

# View logs
docker-compose logs -f

# Or use Make commands
make dev-up
make dev-logs
```

Services will be available at:
- **API**: http://localhost:8000
- **Prisma Studio**: http://localhost:5555
- **PostgreSQL**: localhost:5433
- **Redis**: localhost:6379

#### 3. Run Database Migrations

```bash
docker-compose exec app bunx prisma migrate dev
```

#### 4. Stop Services

```bash
docker-compose down

# Or use Make
make dev-down
```

---

## Production Deployment

### 🌐 Domain & SSL Setup
Your API domain: **api.quantumsocialclub.id**

- **[SSL_QUICK_SETUP.md](./docs/SSL_QUICK_SETUP.md)** - ⚡ **Quick SSL setup** (2 minutes!)
- **[DOMAIN_AND_SSL_SETUP.md](./docs/DOMAIN_AND_SSL_SETUP.md)** - 🔐 Complete domain & SSL guide

### 📚 Deployment Guides
- **[DEPLOYMENT.md](./docs/DEPLOYMENT.md)** - Complete production deployment guide (4GB recommended)
- **[DOCKER_QUICK_REFERENCE.md](./docs/DOCKER_QUICK_REFERENCE.md)** - Quick commands
- **[DEPLOY_SCRIPT_GUIDE.md](./docs/DEPLOY_SCRIPT_GUIDE.md)** - Using `./scripts/deploy.sh`
- **[DEPLOYMENT_CHECKLIST.md](./docs/DEPLOYMENT_CHECKLIST.md)** - Pre-deploy checklist
- **[GETTING_STARTED.md](./docs/GETTING_STARTED.md)** - 5-minute quick start

### 📖 API & Feature Reference
See the [`docs/`](./docs/) directory for API references (analytics, dashboard, payments, email queue, CI/CD, etc.).

### Quick Production Setup

1. **Configure Environment**
   ```bash
   cp docker/env.production.template .env
   # Edit .env with your production values
   # REQUIRED: DB_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET
   ```

2. **Deploy (Automated - Recommended)**
   ```bash
   chmod +x scripts/deploy.sh
   ./scripts/deploy.sh
   ```
   
   The script automatically:
   - ✅ Validates environment variables
   - ✅ Pulls latest code
   - ✅ Builds optimized Docker images
   - ✅ Runs database migrations
   - ✅ Starts all services
   - ✅ Verifies deployment health

3. **Setup SSL (For api.quantumsocialclub.id)**
   ```bash
   chmod +x scripts/setup-ssl.sh
   ./scripts/setup-ssl.sh
   ```
   
   Configures HTTPS with Let's Encrypt:
   - ✅ Free SSL certificate
   - ✅ Auto-renewal every 12 hours
   - ✅ HTTP → HTTPS redirect
   - ✅ Security headers enabled

**Alternative: Manual Deployment**
```bash
# Manual build and deploy
DOCKER_BUILDKIT=1 docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d

# Or use Make commands
make prod-build
make prod-up
```

### Production Features

- ✅ Multi-stage Docker builds (optimized size)
- ✅ Non-root container security
- ✅ Health checks and monitoring
- ✅ Nginx reverse proxy with SSL
- ✅ Redis persistence
- ✅ Database connection pooling
- ✅ Resource limits (CPU/Memory)
- ✅ Log rotation
- ✅ Email worker queue
- ✅ Automated deployment with GitHub Actions

---

## Scripts

### Development
- `dev`: Start the development server with hot reload
- `build`: Build TypeScript to production
- `start`: Start the production server
- `lint`: Run ESLint
- `format`: Format code with Prettier
- `test`: Run tests
- `typecheck`: Run TypeScript type checking

### Database
- `db:push`: Push schema changes to database
- `db:pull`: Pull schema from database
- `db:fresh`: Reset and seed database
- `db:seed`: Seed database with test data
- `db:truncate`: Clear all database tables
- `db:studio`: Open Prisma Studio

### Prisma
- `prisma:generate`: Generate Prisma Client
- `prisma:migrate`: Run database migrations
- `prisma:studio`: Open Prisma Studio

### Workers
- `worker:email`: Start email worker process

### Docker (via Makefile)
- `make dev-up`: Start development environment
- `make dev-down`: Stop development environment
- `make prod-build`: Build production images
- `make prod-up`: Start production services
- `make prod-down`: Stop production services
- `make prod-logs`: View production logs
- `make db-migrate`: Run database migrations
- `make db-backup`: Backup database

---

## Project Structure

```
quantum-sport-backend/
├── src/
│   ├── app.ts              # Main application setup
│   ├── handlers/           # Request handlers
│   ├── routes/             # API routes
│   ├── services/           # Business logic
│   ├── middlewares/        # Custom middlewares
│   ├── lib/                # Utilities and helpers
│   └── workers/            # Background job workers
├── prisma/
│   ├── schema.prisma       # Database schema
│   ├── migrations/         # Database migrations
│   └── seed.ts             # Database seeding
├── docs/                   # Documentation
├── scripts/                # Shell scripts (deploy, SSL, ngrok, etc.)
├── docker/
│   ├── nginx/              # Nginx configuration
│   └── redis.conf          # Redis configuration
├── Dockerfile              # Production Dockerfile
├── Dockerfile.dev          # Development Dockerfile
├── docker-compose.yml      # Development compose
├── docker-compose.prod.yml # Production compose
└── Makefile                # Common Docker operations
```

---

## Environment Variables

See `.env.example` for local development. Production uses `.env` on the server (copy from `docker/env.production.template`).

Key variables:
- `NODE_ENV`: Environment (development/production)
- `PORT`: Server port
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `JWT_SECRET`: JWT signing secret
- `XENDIT_API_KEY`: Xendit payment gateway key
- `SMTP_*`: Email configuration

---

## API Documentation

API documentation is available at `/api/docs` when running in development mode.

---

## Learn More

- [Hono Documentation](https://hono.dev/)
- [Bun Documentation](https://bun.sh/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Docker Documentation](https://docs.docker.com/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Redis Documentation](https://redis.io/docs/)

---

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is proprietary software. All rights reserved.

---

## Support

For issues or questions:
- Open an issue on GitHub
- Contact the development team
- Check the [Development Guide](./docs/develop-guide.md)
- Review [Production Deployment Guide](./docs/DEPLOYMENT.md)

---

**Built with ❤️ by the Quantum Sport Team**
