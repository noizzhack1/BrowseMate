# BrowseMate API

A modern FastAPI application template with comprehensive documentation, Pydantic validation, and Swagger UI.

## 🚀 Features

- **FastAPI** - Modern, fast web framework for building APIs
- **Pydantic v2** - Data validation using Python type annotations
- **Swagger UI** - Interactive API documentation at `/docs`
- **ReDoc** - Alternative documentation at `/redoc`
- **CORS** - Cross-Origin Resource Sharing enabled
- **Type Hints** - Full type annotation support

## 📁 Project Structure

```
BrowseMate/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI application entry point
│   ├── config.py            # Application configuration
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── health.py        # Health check endpoints
│   │   ├── users.py         # User management endpoints
│   │   └── items.py         # Item management endpoints
│   └── schemas/
│       ├── __init__.py
│       ├── common.py        # Shared schemas
│       ├── user.py          # User-related schemas
│       └── item.py          # Item-related schemas
├── requirements.txt
├── .env.example
└── README.md
```

## 🛠️ Installation

1. **Create a virtual environment:**
   ```bash
   python -m venv venv
   ```

2. **Activate the virtual environment:**
   
   Windows:
   ```bash
   .\venv\Scripts\activate
   ```
   
   macOS/Linux:
   ```bash
   source venv/bin/activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```

## 🏃 Running the Application

**Development mode with auto-reload:**
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Production mode:**
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

## 📚 API Documentation

Once the server is running, access the documentation at:

- **Swagger UI:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc
- **OpenAPI JSON:** http://localhost:8000/openapi.json

## 🔗 API Endpoints

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/health/ready` | Readiness check |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/users` | Create a new user |
| GET | `/api/v1/users` | List all users |
| GET | `/api/v1/users/{id}` | Get user by ID |
| PATCH | `/api/v1/users/{id}` | Update user |
| DELETE | `/api/v1/users/{id}` | Delete user |

### Items
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/items` | Create a new item |
| GET | `/api/v1/items` | List all items |
| GET | `/api/v1/items/{id}` | Get item by ID |
| PATCH | `/api/v1/items/{id}` | Update item |
| DELETE | `/api/v1/items/{id}` | Delete item |
| POST | `/api/v1/items/{id}/archive` | Archive item |

## 🧪 Testing

Run tests with pytest:
```bash
pytest
```

## 📝 License

MIT License

