"""
Common Pydantic schemas used across the application.

This module contains shared schemas for health checks, messages,
pagination, path parameters, and other common API patterns.

All parameter schemas use Pydantic's Field for automatic Swagger documentation.
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict


# =============================================================================
# RESPONSE SCHEMAS
# =============================================================================

class HealthResponse(BaseModel):
    """
    Health check response schema.
    
    Used to verify the API is running and responsive.
    
    Attributes:
        status: Current health status of the service.
        timestamp: Server timestamp when health check was performed.
        version: Current API version.
    """
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "status": "healthy",
                "timestamp": "2025-12-07T10:30:00Z",
                "version": "1.0.0"
            }
        }
    )
    
    status: str = Field(
        default="healthy",
        description="Current health status",
        json_schema_extra={"examples": ["healthy", "degraded", "unhealthy"]}
    )
    timestamp: datetime = Field(
        default_factory=datetime.utcnow,
        description="Server timestamp of the health check"
    )
    version: str = Field(
        description="Current API version",
        json_schema_extra={"examples": ["1.0.0"]}
    )


class MessageResponse(BaseModel):
    """
    Generic message response schema.
    
    Used for simple API responses that only return a message.
    
    Attributes:
        message: The response message.
        success: Whether the operation was successful.
    """
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "message": "Operation completed successfully",
                "success": True
            }
        }
    )
    
    message: str = Field(
        description="Response message",
        json_schema_extra={"examples": ["Operation completed successfully"]}
    )
    success: bool = Field(
        default=True,
        description="Whether the operation was successful"
    )


# =============================================================================
# PARAMETER SCHEMAS - For clean function signatures with Depends()
# =============================================================================

class PaginationParams(BaseModel):
    """
    Pagination query parameters.
    
    Use with FastAPI's Depends() for clean endpoint signatures:
    
    ```python
    @router.get("/items")
    async def list_items(pagination: PaginationParams = Depends()):
        skip = pagination.skip
        limit = pagination.limit
    ```
    
    Attributes:
        skip: Number of records to skip (offset).
        limit: Maximum number of records to return.
    """
    model_config = ConfigDict(
        json_schema_extra={
            "example": {"skip": 0, "limit": 10}
        }
    )
    
    skip: int = Field(
        default=0,
        ge=0,
        title="Skip",
        description="Number of records to skip for pagination",
        json_schema_extra={"examples": [0, 10, 20]}
    )
    limit: int = Field(
        default=10,
        ge=1,
        le=100,
        title="Limit",
        description="Maximum number of records to return (1-100)",
        json_schema_extra={"examples": [10, 25, 50]}
    )


class PathId(BaseModel):
    """
    Path parameter for resource ID.
    
    Use with FastAPI's Depends() for clean endpoint signatures:
    
    ```python
    @router.get("/{id}")
    async def get_item(path: PathId = Depends()):
        item_id = path.id
    ```
    
    Attributes:
        id: Unique resource identifier.
    """
    model_config = ConfigDict(
        json_schema_extra={
            "example": {"id": 1}
        }
    )
    
    id: int = Field(
        gt=0,
        title="Resource ID",
        description="Unique identifier of the resource",
        json_schema_extra={"examples": [1, 42, 100]}
    )


class SearchParams(BaseModel):
    """
    Common search/filter query parameters.
    
    Use with FastAPI's Depends() for endpoints that support searching:
    
    ```python
    @router.get("/items")
    async def list_items(search: SearchParams = Depends()):
        query = search.q
    ```
    
    Attributes:
        q: Search query string.
        sort_by: Field to sort by.
        sort_order: Sort direction (asc/desc).
    """
    model_config = ConfigDict(
        json_schema_extra={
            "example": {"q": "widget", "sort_by": "created_at", "sort_order": "desc"}
        }
    )
    
    q: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=100,
        title="Search Query",
        description="Search query string to filter results",
        json_schema_extra={"examples": ["widget", "premium"]}
    )
    sort_by: Optional[str] = Field(
        default=None,
        title="Sort By",
        description="Field name to sort results by",
        json_schema_extra={"examples": ["created_at", "name", "price"]}
    )
    sort_order: Optional[str] = Field(
        default="asc",
        pattern="^(asc|desc)$",
        title="Sort Order",
        description="Sort direction: 'asc' for ascending, 'desc' for descending",
        json_schema_extra={"examples": ["asc", "desc"]}
    )
