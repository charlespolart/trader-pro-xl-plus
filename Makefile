.PHONY: help back web db db-stop build deploy deploy-web
.DEFAULT_GOAL := help

# Backend natif contre Postgres dockerisé. db/db-stop passent par l'overlay dev.
COMPOSE_DEV := docker compose -f ops/docker-compose.yml -f ops/docker-compose.dev.yml

back: ## Backend dev (API Hono + WS, bots, backtests)
	bun run --cwd apps/backend dev
web: ## Front web dev (Vite)
	bun run --cwd apps/web dev
db: ## DB Postgres (docker, arrière-plan)
	$(COMPOSE_DEV) up -d postgres
db-stop: ## Stoppe la DB
	$(COMPOSE_DEV) down
build: ## Build du front web
	bun run --cwd apps/web build
deploy: ## Déploie le BACKEND (CI → GHCR → VPS). Rollback : make deploy TAG=<sha7>
	./ops/scripts/deploy.sh $(TAG)
deploy-web: ## Déploie le FRONT (build + rsync, n'impacte pas le backend)
	./ops/scripts/deploy-web.sh
help: ## Liste les commandes
	@grep -E '^[a-z-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'
