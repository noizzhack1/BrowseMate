"""
BrowseMate FastAPI Application.

This is the main entry point for the FastAPI application.
It configures the app with OpenAPI/Swagger documentation,
sets up middleware, and includes all routers.

Swagger UI is powered by SmartBear's OpenAPI specification,
with automatic documentation generated from Pydantic models.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import users_router, items_router, health_router
import uvicorn


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager.
    
    Handles startup and shutdown events for the application.
    Use this for database connections, cache initialization, etc.
    """
    # Startup
    print("🚀 Starting up BrowseMate API...")
    yield
    # Shutdown
    print("👋 Shutting down BrowseMate API...")


def create_application() -> FastAPI:
    """
    Application factory function.
    
    Creates and configures the FastAPI application with OpenAPI/Swagger
    documentation, middleware, and routers.
    
    Returns:
        FastAPI: Configured application instance.
    """
    settings = get_settings()
    
    app = FastAPI(
        # Basic info
        title=settings.app_name,
        version=settings.app_version,
        description=settings.app_description,
        debug=settings.debug,
        lifespan=lifespan,
        
        # OpenAPI/Swagger configuration
        openapi_url="/openapi.json",
        docs_url="/docs",
        redoc_url="/redoc",
        
        # OpenAPI metadata for Swagger UI
        openapi_tags=[
            {
                "name": "Health",
                "description": "Health check and monitoring endpoints for service status verification.",
            },
            {
                "name": "Users",
                "description": "User management operations - create, read, update, and delete user accounts.",
            },
            {
                "name": "Items",
                "description": "Item/Product catalog operations - manage products, inventory, and listings.",
            },
        ],
        
        # Swagger UI customization
        swagger_ui_parameters={
            "persistAuthorization": True,
            "displayRequestDuration": True,
            "filter": True,
            "showExtensions": True,
            "showCommonExtensions": True,
            "syntaxHighlight.theme": "monokai",
            "docExpansion": "list",
            "defaultModelsExpandDepth": 3,
            "defaultModelExpandDepth": 3,
            "tryItOutEnabled": True,
        },
        
        # API metadata
        terms_of_service="https://browsemate.dev/terms",
        contact={
            "name": "BrowseMate API Support",
            "url": "https://browsemate.dev/support",
            "email": "support@browsemate.dev",
        },
        license_info={
            "name": "MIT License",
            "identifier": "MIT",
            "url": "https://opensource.org/licenses/MIT",
        },
        
        # Servers configuration for Swagger
        servers=[
            {
                "url": "http://localhost:8000",
                "description": "Local Development Server"
            },
            {
                "url": "https://api.browsemate.dev",
                "description": "Production Server"
            },
        ],
    )
    
    # Configure CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Configure appropriately for production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Include routers with API prefix
    app.include_router(health_router, prefix=settings.api_prefix)
    app.include_router(users_router, prefix=settings.api_prefix)
    app.include_router(items_router, prefix=settings.api_prefix)
    
    return app


# Create the application instance
app = create_application()


@app.get(
    "/",
    include_in_schema=False,
    summary="API Root",
    description="Root endpoint with API information and documentation links."
)
async def root():
    """
    Root endpoint with API navigation links.
    
    Returns:
        dict: Welcome message and documentation URLs.
    """
    return {
        "message": "Welcome to BrowseMate API",
        "documentation": {
            "swagger_ui": "/docs",
            "redoc": "/redoc",
            "openapi_json": "/openapi.json"
        },
        "health_check": "/api/v1/health",
        "version": get_settings().app_version
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, debug=True)