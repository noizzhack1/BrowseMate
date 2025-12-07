"""
Item management router.

This module provides CRUD endpoints for item/product management
including creation, updates, listing, and filtering.

All endpoints use Pydantic models for parameter typing via Depends(),
ensuring clean function signatures and automatic Swagger documentation.
"""

from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, status

from app.schemas.item import (
    ItemCreate,
    ItemUpdate,
    ItemResponse,
    ItemListResponse,
    ItemFilterParams,
    ItemPathParams,
    ItemStatus,
)
from app.schemas.common import MessageResponse, PaginationParams


router = APIRouter(
    prefix="/items",
    tags=["Items"],
    responses={
        404: {"description": "Item not found"},
        422: {"description": "Validation error"}
    }
)

# In-memory storage for demo purposes
# Replace with actual database in production
_fake_items_db: dict[int, dict] = {}
_item_id_counter = 0


@router.post(
    "",
    response_model=ItemResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create New Item",
    description="Create a new item in the catalog. Items start in `draft` status by default.",
    response_description="The newly created item"
)
async def create_item(item: ItemCreate) -> ItemResponse:
    """
    Create a new item in the catalog.
    
    Args:
        item: ItemCreate schema with item data.
    
    Returns:
        ItemResponse: The created item with ID and timestamps.
    """
    global _item_id_counter
    
    _item_id_counter += 1
    now = datetime.utcnow()
    
    item_dict = {
        "id": _item_id_counter,
        "name": item.name,
        "description": item.description,
        "price": float(item.price),
        "status": item.status.value,
        "tags": item.tags,
        "owner_id": item.owner_id,
        "created_at": now,
        "updated_at": None,
    }
    _fake_items_db[_item_id_counter] = item_dict
    
    return ItemResponse(**item_dict)


@router.get(
    "",
    response_model=ItemListResponse,
    status_code=status.HTTP_200_OK,
    summary="List All Items",
    description="Retrieve a paginated and filterable list of items with support for status, owner, and price range filters.",
    response_description="Paginated list of items"
)
async def list_items(
    pagination: PaginationParams = Depends(),
    filters: ItemFilterParams = Depends()
) -> ItemListResponse:
    """
    Get a filtered, paginated list of items.
    
    Args:
        pagination: Pagination parameters (skip, limit).
        filters: Filter parameters (status, owner_id, min_price, max_price, tag).
    
    Returns:
        ItemListResponse: Filtered and paginated list of items.
    """
    items = list(_fake_items_db.values())
    
    # Apply filters
    if filters.status:
        items = [i for i in items if i["status"] == filters.status.value]
    if filters.owner_id:
        items = [i for i in items if i["owner_id"] == filters.owner_id]
    if filters.min_price is not None:
        items = [i for i in items if i["price"] >= filters.min_price]
    if filters.max_price is not None:
        items = [i for i in items if i["price"] <= filters.max_price]
    if filters.tag:
        items = [i for i in items if filters.tag in i.get("tags", [])]
    
    total = len(items)
    paginated_items = items[pagination.skip:pagination.skip + pagination.limit]
    
    return ItemListResponse(
        items=[ItemResponse(**i) for i in paginated_items],
        total=total,
        skip=pagination.skip,
        limit=pagination.limit
    )


@router.get(
    "/{item_id}",
    response_model=ItemResponse,
    status_code=status.HTTP_200_OK,
    summary="Get Item by ID",
    description="Retrieve a specific item by its unique identifier.",
    response_description="The requested item"
)
async def get_item(path: ItemPathParams = Depends()) -> ItemResponse:
    """
    Get an item by its ID.
    
    Args:
        path: Path parameters containing item_id.
    
    Returns:
        ItemResponse: The requested item data.
    
    Raises:
        HTTPException: 404 if item is not found.
    """
    if path.item_id not in _fake_items_db:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Item with ID {path.item_id} not found"
        )
    
    return ItemResponse(**_fake_items_db[path.item_id])


@router.patch(
    "/{item_id}",
    response_model=ItemResponse,
    status_code=status.HTTP_200_OK,
    summary="Update Item",
    description="Update an existing item's information. Only provided fields will be updated (partial update).",
    response_description="The updated item"
)
async def update_item(
    body: ItemUpdate,
    path: ItemPathParams = Depends()
) -> ItemResponse:
    """
    Update an item's information.
    
    Args:
        body: ItemUpdate schema with fields to update.
        path: Path parameters containing item_id.
    
    Returns:
        ItemResponse: The updated item data.
    
    Raises:
        HTTPException: 404 if item not found.
    """
    if path.item_id not in _fake_items_db:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Item with ID {path.item_id} not found"
        )
    
    item_dict = _fake_items_db[path.item_id]
    update_data = body.model_dump(exclude_unset=True)
    
    # Convert status enum to string value
    if "status" in update_data and update_data["status"]:
        update_data["status"] = update_data["status"].value
    
    # Convert Decimal price to float
    if "price" in update_data and update_data["price"]:
        update_data["price"] = float(update_data["price"])
    
    item_dict.update(update_data)
    item_dict["updated_at"] = datetime.utcnow()
    
    return ItemResponse(**item_dict)


@router.delete(
    "/{item_id}",
    response_model=MessageResponse,
    status_code=status.HTTP_200_OK,
    summary="Delete Item",
    description="Delete an item from the catalog. This action is permanent and cannot be undone.",
    response_description="Deletion confirmation"
)
async def delete_item(path: ItemPathParams = Depends()) -> MessageResponse:
    """
    Delete an item by its ID.
    
    Args:
        path: Path parameters containing item_id.
    
    Returns:
        MessageResponse: Confirmation of deletion.
    
    Raises:
        HTTPException: 404 if item is not found.
    """
    if path.item_id not in _fake_items_db:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Item with ID {path.item_id} not found"
        )
    
    del _fake_items_db[path.item_id]
    
    return MessageResponse(
        message=f"Item {path.item_id} successfully deleted",
        success=True
    )


@router.post(
    "/{item_id}/archive",
    response_model=ItemResponse,
    status_code=status.HTTP_200_OK,
    summary="Archive Item",
    description="Archive an item instead of deleting it. Sets status to `archived`, hiding it from normal listings while preserving the data.",
    response_description="The archived item"
)
async def archive_item(path: ItemPathParams = Depends()) -> ItemResponse:
    """
    Archive an item (soft delete).
    
    Args:
        path: Path parameters containing item_id.
    
    Returns:
        ItemResponse: The archived item.
    
    Raises:
        HTTPException: 404 if item is not found.
    """
    if path.item_id not in _fake_items_db:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Item with ID {path.item_id} not found"
        )
    
    item_dict = _fake_items_db[path.item_id]
    item_dict["status"] = ItemStatus.ARCHIVED.value
    item_dict["updated_at"] = datetime.utcnow()
    
    return ItemResponse(**item_dict)
