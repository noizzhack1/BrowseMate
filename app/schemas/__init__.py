"""
Pydantic schemas package.

This package contains all Pydantic models used for request/response
validation and serialization throughout the API.

Schemas are organized by domain:
- common.py: Shared schemas (responses, pagination, path params)
- user.py: User-related schemas
- item.py: Item-related schemas

All schemas support automatic OpenAPI/Swagger documentation generation.
"""

from app.schemas.user import (
    UserCreate,
    UserUpdate,
    UserResponse,
    UserListResponse,
    UserFilterParams,
    UserPathParams,
)
from app.schemas.item import (
    ItemStatus,
    ItemCreate,
    ItemUpdate,
    ItemResponse,
    ItemListResponse,
    ItemFilterParams,
    ItemPathParams,
)
from app.schemas.common import (
    HealthResponse,
    MessageResponse,
    PaginationParams,
    PathId,
    SearchParams,
)

__all__ = [
    # User schemas
    "UserCreate",
    "UserUpdate",
    "UserResponse",
    "UserListResponse",
    "UserFilterParams",
    "UserPathParams",
    # Item schemas
    "ItemStatus",
    "ItemCreate",
    "ItemUpdate",
    "ItemResponse",
    "ItemListResponse",
    "ItemFilterParams",
    "ItemPathParams",
    # Common schemas
    "HealthResponse",
    "MessageResponse",
    "PaginationParams",
    "PathId",
    "SearchParams",
]
