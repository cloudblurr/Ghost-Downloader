# Ghost Search Backend

AI-powered privacy-first media search API — the brain behind Ghost Search.

## Architecture

```
backend/
├── app/
│   ├── main.py              # FastAPI entry point
│   ├── config.py             # Environment-based config
│   ├── agents/
│   │   ├── orchestrator.py   # Search pipeline coordinator
│   │   ├── query_parser.py   # LLM query → structured params
│   │   ├── scorer.py         # LLM result scoring & ranking
│   │   └── safety.py         # Hard pre-LLM content safety filter
│   ├── scrapers/
│   │   ├── base.py           # Abstract scraper interface
│   │   ├── registry.py       # Auto-discovers & holds all scrapers
│   │   ├── erome.py          # Erome search
│   │   ├── redgifs.py        # RedGifs API
│   │   ├── pornhub.py        # Pornhub web scraping
│   │   ├── xvideos.py        # XVideos web scraping
│   │   ├── stash.py          # Stash + ThePornDB GraphQL
│   │   └── brave.py          # Brave Search API fallback
│   ├── models/
│   │   ├── schemas.py        # Pydantic request/response models
│   │   └── database.py       # SQLite cache + preferences
│   ├── routers/
│   │   ├── search.py         # POST /api/ghost-search
│   │   ├── analyze.py        # POST /api/analyze
│   │   └── preferences.py    # GET/PUT /api/preferences
│   ├── services/
│   │   ├── cache.py          # Result cache helpers
│   │   └── vector_store.py   # Optional ChromaDB integration
│   └── utils/
│       ├── logger.py         # Centralized logging
│       └── rate_limit.py     # In-memory rate limiter
├── requirements.txt
├── pyproject.toml
├── Dockerfile
└── .env.example
```

## Quickstart

### 1. Install dependencies

```bash
cd backend
pip install -r requirements.txt
```

Or with uv:
```bash
uv pip install -r requirements.txt
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env — at minimum set GROQ_API_KEY
```

### 3. Run

```bash
uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.

- Swagger docs: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/health`

### 4. Connect to Next.js

In your Next.js app (or `.env.local`):
```
GHOST_SEARCH_URL=http://localhost:8000
```

The Next.js proxy route at `/api/ghost-search` will forward requests to the Python backend.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ghost-search` | Search across all sources |
| POST | `/api/analyze` | Analyze a single URL for metadata |
| GET | `/api/preferences` | Get user preferences |
| PUT | `/api/preferences` | Update user preferences |
| GET | `/api/sources` | List available search sources |
| GET | `/health` | Health check |

### Example: Search

```bash
curl -X POST http://localhost:8000/api/ghost-search \
  -H "Content-Type: application/json" \
  -d '{"query": "amateur redhead", "per_page": 10}'
```

## Docker

```bash
# From project root
docker compose up --build
```

This starts:
- Next.js frontend on port 3000
- Ghost Search backend on port 8000

## Adding a New Scraper

1. Create `backend/app/scrapers/mysite.py`
2. Extend `BaseScraper` and implement `search()`
3. Import it in `registry.py` and add to the defaults list

```python
from app.scrapers.base import BaseScraper
from app.models.schemas import MediaType, SearchResult

class MySiteScraper(BaseScraper):
    id = "mysite"
    name = "My Site"
    description = "Description here"
    media_types = [MediaType.VIDEO]

    async def search(self, keywords, page=1, per_page=20):
        # Your scraping logic here
        return [SearchResult(...)]
```

## Environment Variables

See `.env.example` for all available configuration options.

Required:
- `GROQ_API_KEY` — Groq API key for LLM features

Recommended:
- `BRAVE_API_KEY` — Enables Brave Search fallback for broad queries

Optional:
- `STASH_API_URL` / `STASH_API_KEY` — Local Stash instance
- `THEPORNDB_API_KEY` — ThePornDB metadata enrichment
- `ENABLE_VECTOR_DB=true` — Enable ChromaDB for semantic caching
