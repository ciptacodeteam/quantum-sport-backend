# Docker Makefile for common operations

.PHONY: help build up down restart logs shell db-migrate db-backup db-backup-setup clean

# Default target
help:
	@echo "Available commands:"
	@echo "  make prod-build    - Build production images"
	@echo "  make prod-up       - Start production services"
	@echo "  make prod-up-build - Start production services with build"
	@echo "  make prod-down     - Stop production services"
	@echo "  make prod-restart  - Restart production services"
	@echo "  make prod-logs     - View production logs"
	@echo "  make dev-up        - Start development services"
	@echo "  make dev-up-build  - Start development services with build"
	@echo "  make dev-down      - Stop development services"
	@echo "  make logs          - View development logs"
	@echo "  make shell         - Access app container shell"
	@echo "  make db-migrate       Run database migrations"
	@echo "  make db-backup        Backup DB to Vercel Blob"
	@echo "  make db-backup-setup  Install daily backup cron (VPS)"
	@echo "  make clean         - Clean up containers and volumes"
	@echo "  make clean-all     - Clean up all containers, images, and volumes"

# Production commands
prod-build:
	docker-compose -f docker-compose.prod.yml build --no-cache

prod-up:
	docker-compose -f docker-compose.prod.yml up -d

prod-up-build:
	docker-compose -f docker-compose.prod.yml up -d --build

prod-down:
	docker-compose -f docker-compose.prod.yml down

prod-restart:
	docker-compose -f docker-compose.prod.yml restart

prod-logs:
	docker-compose -f docker-compose.prod.yml logs -f

prod-shell:
	docker-compose -f docker-compose.prod.yml exec app sh

# Development commands
dev-up:
	docker-compose up -d

dev-up-build:
	docker-compose up -d --build

dev-down:
	docker-compose down

dev-logs:
	docker-compose logs -f

dev-shell:
	docker-compose exec app sh

dev-migrate:
	docker-compose exec app bunx prisma db push

# Database commands
db-migrate:
	docker-compose -f docker-compose.prod.yml exec app bunx prisma migrate deploy

db-backup:
	./scripts/backup-db.sh

db-backup-setup:
	./scripts/setup-backup-cron.sh

db-restore:
	./scripts/restore-db.sh $(FILE)

# Cleanup commands
clean:
	docker-compose -f docker-compose.prod.yml down -v
	docker system prune -f

clean-all:
	docker-compose down -v
	docker-compose -f docker-compose.prod.yml down -v
	docker system prune -af --volumes
