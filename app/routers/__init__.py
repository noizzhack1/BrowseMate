"""
API Routers package.

This package contains all API route handlers organized by domain.
Each router module handles a specific resource or feature area.
"""

from app.routers.users import router as users_router
from app.routers.items import router as items_router
from app.routers.health import router as health_router

__all__ = [
    "users_router",
    "items_router",
    "health_router",
]

