.PHONY: help back web db db-stop build
.DEFAULT_GOAL := help

# Backend natif contre Postgres dockerisé : la base compose expose le port hôte.
COMPOSE := docker compose -f ops/docker-compose.yml

back: ## Backend dev (API Hono + WS, bots, backtests)
	bun run --cwd apps/backend dev
web: ## Front web dev (Vite)
	bun run --cwd apps/web dev
db: ## DB Postgres (docker, arrière-plan)
	$(COMPOSE) up -d postgres
db-stop: ## Stoppe la DB
	$(COMPOSE) down
build: ## Build du front web
	bun run --cwd apps/web build
help: ## Liste les commandes
	@grep -E '^[a-z-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}; {printf "  \033[36m%-8s\033[0m %s\n", $$1, $$2}'
