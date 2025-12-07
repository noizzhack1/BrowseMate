"""
Item-related Pydantic schemas.

This module contains all schemas related to item/product operations
including creation, updates, responses, and query parameters.

All schemas use Pydantic v2 with ConfigDict and Field for automatic
OpenAPI/Swagger documentation generation.
"""

from datetime import datetime
from typing import Optional, List
from decimal import Decimal
from enum import Enum
from pydantic import BaseModel, Field, ConfigDict


# =============================================================================
# ENUMS
# =============================================================================

class ItemStatus(str, Enum):
    """
    Enumeration of possible item statuses.
    
    Values:
        DRAFT: Item is in draft mode, not visible to customers.
        ACTIVE: Item is active and visible in the catalog.
        ARCHIVED: Item is archived and hidden from listings.
    """
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"


# =============================================================================
# REQUEST SCHEMAS
# =============================================================================

class ItemBase(BaseModel):
    """
    Base item schema with common attributes.
    
    Parent class for create and response schemas containing
    shared field definitions with full documentation.
    """
    model_config = ConfigDict(
        str_strip_whitespace=True,
        validate_assignment=True
    )
    
    name: str = Field(
        min_length=1,
        max_length=200,
        title="Item Name",
        description="Name of the item (1-200 characters)",
        json_schema_extra={"examples": ["Premium Widget", "Deluxe Gadget"]}
    )
    description: Optional[str] = Field(
        default=None,
        max_length=2000,
        title="Description",
        description="Detailed description of the item (max 2000 characters)",
        json_schema_extra={"examples": ["A high-quality widget for all your needs"]}
    )
    price: Decimal = Field(
        ge=0,
        decimal_places=2,
        title="Price",
        description="Price of the item in decimal format (>= 0)",
        json_schema_extra={"examples": [29.99, 149.50, 9.99]}
    )
    status: ItemStatus = Field(
        default=ItemStatus.DRAFT,
        title="Status",
        description="Current status of the item"
    )
    tags: List[str] = Field(
        default_factory=list,
        max_length=10,
        title="Tags",
        description="List of tags for categorization (max 10 tags)",
        json_schema_extra={"examples": [["electronics", "gadgets"], ["home", "kitchen"]]}
    )


class ItemCreate(ItemBase):
    """
    Schema for creating a new item.
    
    Inherits all fields from ItemBase and adds owner_id.
    Used as request body for POST /items endpoint.
    
    Required Fields:
        - name: Item name (1-200 chars)
        - price: Item price (>= 0)
        - owner_id: ID of the user creating the item
    
    Optional Fields:
        - description: Item description
        - status: Item status (default: draft)
        - tags: List of tags (default: [])
    """
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "name": "Premium Widget",
                "description": "A high-quality widget for all your needs",
                "price": 29.99,
                "status": "draft",
                "tags": ["electronics", "gadgets"],
                "owner_id": 1
            }
        }
    )
    
    owner_id: int = Field(
        gt=0,
        title="Owner ID",
        description="ID of the user who owns this item",
        json_schema_extra={"examples": [1, 42]}
    )


class ItemUpdate(BaseModel):
    """
    Schema for updating an existing item (partial update).
    
    All fields are optional - only provided fields will be updated.
    Used as request body for PATCH /items/{id} endpoint.
    
    Updatable Fields:
        - name: New item name
        - description: New description
        - price: New price
        - status: New status (draft/active/archived)
        - tags: New tags list
    """
    model_config = ConfigDict(
        str_strip_whitespace=True,
        json_schema_extra={
            "example": {
                "price": 24.99,
                "status": "active"
            }
        }
    )
    
    name: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=200,
        title="Item Name",
        description="New item name"
    )
    description: Optional[str] = Field(
        default=None,
        max_length=2000,
        title="Description",
        description="New item description"
    )
    price: Optional[Decimal] = Field(
        default=None,
        ge=0,
        decimal_places=2,
        title="Price",
        description="New item price"
    )
    status: Optional[ItemStatus] = Field(
        default=None,
        title="Status",
        description="New item status"
    )
    tags: Optional[List[str]] = Field(
        default=None,
        max_length=10,
        title="Tags",
        description="New tags list"
    )


# =============================================================================
# RESPONSE SCHEMAS
# =============================================================================

class ItemResponse(ItemBase):
    """
    Schema for item response data.
    
    Extends ItemBase with server-generated fields.
    Used as response model for all item endpoints.
    
    Additional Fields:
        - id: Unique item identifier (auto-generated)
        - owner_id: ID of the item owner
        - created_at: Creation timestamp
        - updated_at: Last update timestamp
    """
    model_config = ConfigDict(
        from_attributes=True,
        json_schema_extra={
            "example": {
                "id": 1,
                "name": "Premium Widget",
                "description": "A high-quality widget for all your needs",
                "price": 29.99,
                "status": "active",
                "tags": ["electronics", "gadgets"],
                "owner_id": 1,
                "created_at": "2025-12-07T10:00:00Z",
                "updated_at": None
            }
        }
    )
    
    id: int = Field(
        title="Item ID",
        description="Unique item identifier",
        json_schema_extra={"examples": [1, 42]}
    )
    owner_id: int = Field(
        title="Owner ID",
        description="ID of the item owner",
        json_schema_extra={"examples": [1]}
    )
    created_at: datetime = Field(
        title="Created At",
        description="Timestamp when item was created"
    )
    updated_at: Optional[datetime] = Field(
        default=None,
        title="Updated At",
        description="Timestamp when item was last updated"
    )


class ItemListResponse(BaseModel):
    """
    Schema for paginated list of items.
    
    Used as response model for GET /items endpoint.
    
    Fields:
        - items: List of item objects
        - total: Total count of items matching query
        - skip: Number of records skipped
        - limit: Maximum records returned
    """
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "items": [
                    {
                        "id": 1,
                        "name": "Premium Widget",
                        "description": "A high-quality widget",
                        "price": 29.99,
                        "status": "active",
                        "tags": ["electronics"],
                        "owner_id": 1,
                        "created_at": "2025-12-07T10:00:00Z",
                        "updated_at": None
                    }
                ],
                "total": 1,
                "skip": 0,
                "limit": 10
            }
        }
    )
    
    items: List[ItemResponse] = Field(
        title="Items",
        description="List of item objects"
    )
    total: int = Field(
        title="Total",
        description="Total number of items matching the query",
        json_schema_extra={"examples": [50]}
    )
    skip: int = Field(
        title="Skip",
        description="Number of records skipped",
        json_schema_extra={"examples": [0]}
    )
    limit: int = Field(
        title="Limit",
        description="Maximum records returned",
        json_schema_extra={"examples": [10]}
    )


# =============================================================================
# QUERY PARAMETER SCHEMAS - For clean function signatures with Depends()
# =============================================================================

class ItemFilterParams(BaseModel):
    """
    Query parameters for filtering items.
    
    Use with FastAPI's Depends() for clean endpoint signatures:
    
    ```python
    from fastapi import Depends
    
    @router.get("/items")
    async def list_items(filters: ItemFilterParams = Depends()):
        status = filters.status
        min_price = filters.min_price
    ```
    
    All parameters are optional and can be combined for complex filtering.
    """
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "status": "active",
                "owner_id": 1,
                "min_price": 10.00,
                "max_price": 100.00
            }
        }
    )
    
    status: Optional[ItemStatus] = Field(
        default=None,
        title="Status Filter",
        description="Filter items by status (draft/active/archived)"
    )
    owner_id: Optional[int] = Field(
        default=None,
        gt=0,
        title="Owner ID Filter",
        description="Filter items by owner user ID",
        json_schema_extra={"examples": [1, 42]}
    )
    min_price: Optional[float] = Field(
        default=None,
        ge=0,
        title="Minimum Price",
        description="Filter items with price >= this value",
        json_schema_extra={"examples": [10.00, 25.00]}
    )
    max_price: Optional[float] = Field(
        default=None,
        ge=0,
        title="Maximum Price",
        description="Filter items with price <= this value",
        json_schema_extra={"examples": [100.00, 500.00]}
    )
    tag: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=50,
        title="Tag Filter",
        description="Filter items containing this tag",
        json_schema_extra={"examples": ["electronics", "sale"]}
    )


class ItemPathParams(BaseModel):
    """
    Path parameters for item endpoints.
    
    Use with FastAPI's Depends() for clean endpoint signatures:
    
    ```python
    from fastapi import Depends
    
    @router.get("/items/{item_id}")
    async def get_item(path: ItemPathParams = Depends()):
        item_id = path.item_id
    ```
    """
    model_config = ConfigDict(
        json_schema_extra={
            "example": {"item_id": 1}
        }
    )
    
    item_id: int = Field(
        gt=0,
        title="Item ID",
        description="Unique identifier of the item",
        json_schema_extra={"examples": [1, 42, 100]}
    )
