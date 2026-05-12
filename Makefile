.PHONY: help check-python check-venv check-docker setup dev docker-up docker-down docker-logs test lint format migrate seed-demo clean

DOCKER_COMPOSE = docker compose
DOCKER_COMPOSE_DEV = docker compose -f docker-compose.dev.yml
PYTHON ?= python3.12
VENV ?= .venv
VENV_PYTHON = $(VENV)/bin/python
VENV_PYTHON_ABS = $(abspath $(VENV_PYTHON))
VENV_PIP = "$(VENV_PYTHON_ABS)" -m pip

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── Local development ─────────────────────────────────────────────────────────

check-python: ## Verify PYTHON points to Python 3.12
	@command -v $(PYTHON) >/dev/null 2>&1 || { echo "$(PYTHON) not found. Run: brew install python@3.12"; exit 1; }
	@$(PYTHON) -c 'import sys; version = ".".join(map(str, sys.version_info[:3])); raise SystemExit(0 if sys.version_info[:2] == (3, 12) else f"Python 3.12 required, got {version}")'

check-venv: ## Verify .venv exists and uses Python 3.12
	@"$(VENV_PYTHON_ABS)" -c 'import sys; version = ".".join(map(str, sys.version_info[:3])); raise SystemExit(0 if sys.version_info[:2] == (3, 12) else f".venv must use Python 3.12, got {version}")' || { echo "Run: rm -rf $(VENV) && make setup"; exit 1; }

setup: check-python ## Create Python 3.12 venv and install all dependencies locally
	@if [ -x "$(VENV_PYTHON)" ]; then \
		"$(VENV_PYTHON_ABS)" -c 'import sys; version = ".".join(map(str, sys.version_info[:3])); raise SystemExit(0 if sys.version_info[:2] == (3, 12) else f"Existing $(VENV) must use Python 3.12, got {version}")' || { echo "Run: rm -rf $(VENV) && make setup"; exit 1; }; \
	else \
		$(PYTHON) -m venv "$(VENV)"; \
	fi
	$(VENV_PIP) install --upgrade pip setuptools wheel
	$(VENV_PIP) install -r backend/requirements.txt
	cd frontend && npm ci

dev-backend: check-venv ## Run backend in dev mode (hot reload)
	cd backend && "$(VENV_PYTHON_ABS)" -m uvicorn app.main:app --reload --port 8000

dev-frontend: ## Run frontend dev server
	cd frontend && npm run dev

# ── Docker ────────────────────────────────────────────────────────────────────

check-docker: ## Verify Docker daemon is reachable
	@docker info >/dev/null 2>&1 || { echo "Docker daemon is not reachable. Start Docker Desktop, then retry."; exit 1; }

docker-up: check-docker ## Build and start all services (production-like)
	@cp -n .env.example .env 2>/dev/null || true
	$(DOCKER_COMPOSE) up --build -d
	@echo "✓ App running at http://localhost"

docker-up-dev: check-docker ## Start development stack (with hot reload)
	$(DOCKER_COMPOSE_DEV) up -d
	@echo "✓ Backend at http://localhost:8000"

docker-down: check-docker ## Stop all services
	$(DOCKER_COMPOSE) down

docker-down-dev: check-docker ## Stop dev services
	$(DOCKER_COMPOSE_DEV) down

docker-logs: check-docker ## Tail logs from all services
	$(DOCKER_COMPOSE) logs -f

docker-logs-backend: check-docker ## Tail backend logs
	$(DOCKER_COMPOSE) logs -f backend

# ── Database ──────────────────────────────────────────────────────────────────

migrate: check-venv ## Run Alembic migrations
	cd backend && "$(VENV_PYTHON_ABS)" -m alembic upgrade head

migrate-down: check-venv ## Rollback last migration
	cd backend && "$(VENV_PYTHON_ABS)" -m alembic downgrade -1

migrate-history: check-venv ## Show migration history
	cd backend && "$(VENV_PYTHON_ABS)" -m alembic history

# ── Testing ───────────────────────────────────────────────────────────────────

test: check-venv ## Run all backend tests
	cd backend && "$(VENV_PYTHON_ABS)" -m pytest app/tests/ -v --cov=app --cov-report=term-missing

test-fast: check-venv ## Run tests without coverage
	cd backend && "$(VENV_PYTHON_ABS)" -m pytest app/tests/ -v -x

test-frontend: ## Run frontend unit tests
	cd frontend && npm test

test-e2e: ## Run Playwright E2E tests
	cd frontend && npm run test:e2e

# ── Code quality ──────────────────────────────────────────────────────────────

lint: check-venv ## Lint backend (ruff) and frontend (eslint)
	cd backend && "$(VENV_PYTHON_ABS)" -m ruff check app/
	cd frontend && npm run lint

format: check-venv ## Format backend (black) and frontend (prettier)
	cd backend && "$(VENV_PYTHON_ABS)" -m black app/
	cd frontend && npm run format

# ── Demo ──────────────────────────────────────────────────────────────────────

seed-demo: ## Seed demo data (requires running backend)
	@echo "Seeding demo users..."
	@curl -s -X POST http://localhost/api/v1/auth/register/options \
		-H "Content-Type: application/json" \
		-d '{"username":"alice","display_name":"Alice"}' | python3 -m json.tool | head -5
	@echo "Done. Use the app UI to complete registration with a passkey."

clean: ## Remove all build artifacts
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .mypy_cache -exec rm -rf {} + 2>/dev/null || true
	rm -rf frontend/dist frontend/node_modules
	$(DOCKER_COMPOSE) down -v 2>/dev/null || true
