"""
User management router.

This module provides CRUD endpoints for user management including
registration, profile updates, and user listing.

All endpoints use Pydantic models for parameter typing via Depends(),
ensuring clean function signatures and automatic Swagger documentation.
"""

from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, status

from app.schemas.user import (
    UserCreate,
    UserUpdate,
    UserResponse,
    UserListResponse,
    UserFilterParams,
    UserPathParams,
)
from app.schemas.common import MessageResponse, PaginationParams


router = APIRouter(
    prefix="/users",
    tags=["Users"],
    responses={
        404: {"description": "User not found"},
        422: {"description": "Validation error"}
    }
)

# In-memory storage for demo purposes
# Replace with actual database in production
_fake_users_db: dict[int, dict] = {}
_user_id_counter = 0


@router.post(
    "",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create New User",
    description="Register a new user in the system. Email and username must be unique across all users.",
    response_description="The newly created user"
)
async def create_user(body: UserCreate) -> UserResponse:
    """
    Create a new user account.
    
    Args:
        body: UserCreate schema with registration data.
    
    Returns:
        UserResponse: The created user with ID and timestamps.
    
    Raises:
        HTTPException: 400 if email or username already exists.
    """
    global _user_id_counter
    
    # Check for duplicate email/username
    for existing_user in _fake_users_db.values():
        if existing_user["email"] == body.email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered"
            )
        if existing_user["username"] == body.username:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already taken"
            )
    
    _user_id_counter += 1
    now = datetime.utcnow()
    
    user_dict = {
        "id": _user_id_counter,
        "email": body.email,
        "username": body.username,
        "full_name": body.full_name,
        "is_active": body.is_active,
        "created_at": now,
        "updated_at": None,
    }
    _fake_users_db[_user_id_counter] = user_dict
    
    return UserResponse(**user_dict)


@router.get(
    "",
    response_model=UserListResponse,
    status_code=status.HTTP_200_OK,
    summary="List All Users",
    description="Retrieve a paginated and filterable list of all users.",
    response_description="Paginated list of users"
)
async def list_users(
    pagination: PaginationParams = Depends(),
    filters: UserFilterParams = Depends()
) -> UserListResponse:
    """
    Get a filtered, paginated list of all users.
    
    Args:
        pagination: Pagination parameters (skip, limit).
        filters: Filter parameters (is_active, email_contains, username_contains).
    
    Returns:
        UserListResponse: Paginated list of users with metadata.
    """
    users = list(_fake_users_db.values())
    
    # Apply filters
    if filters.is_active is not None:
        users = [u for u in users if u["is_active"] == filters.is_active]
    if filters.email_contains:
        users = [u for u in users if filters.email_contains.lower() in u["email"].lower()]
    if filters.username_contains:
        users = [u for u in users if filters.username_contains.lower() in u["username"].lower()]
    
    total = len(users)
    paginated_users = users[pagination.skip:pagination.skip + pagination.limit]
    
    return UserListResponse(
        users=[UserResponse(**u) for u in paginated_users],
        total=total,
        skip=pagination.skip,
        limit=pagination.limit
    )


@router.get(
    "/{user_id}",
    response_model=UserResponse,
    status_code=status.HTTP_200_OK,
    summary="Get User by ID",
    description="Retrieve a specific user by their unique identifier.",
    response_description="The requested user"
)
async def get_user(path: UserPathParams = Depends()) -> UserResponse:
    """
    Get a user by their ID.
    
    Args:
        path: Path parameters containing user_id.
    
    Returns:
        UserResponse: The requested user data.
    
    Raises:
        HTTPException: 404 if user is not found.
    """
    if path.user_id not in _fake_users_db:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with ID {path.user_id} not found"
        )
    
    return UserResponse(**_fake_users_db[path.user_id])


@router.patch(
    "/{user_id}",
    response_model=UserResponse,
    status_code=status.HTTP_200_OK,
    summary="Update User",
    description="Update an existing user's information. Only provided fields will be updated (partial update).",
    response_description="The updated user"
)
async def update_user(
    body: UserUpdate,
    path: UserPathParams = Depends()
) -> UserResponse:
    """
    Update a user's information.
    
    Args:
        body: UserUpdate schema with fields to update.
        path: Path parameters containing user_id.
    
    Returns:
        UserResponse: The updated user data.
    
    Raises:
        HTTPException: 404 if user not found, 400 if conflict occurs.
    """
    if path.user_id not in _fake_users_db:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with ID {path.user_id} not found"
        )
    
    user_dict = _fake_users_db[path.user_id]
    update_data = body.model_dump(exclude_unset=True)
    
    # Check for conflicts
    if "email" in update_data:
        for uid, u in _fake_users_db.items():
            if uid != path.user_id and u["email"] == update_data["email"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email already registered"
                )
    
    if "username" in update_data:
        for uid, u in _fake_users_db.items():
            if uid != path.user_id and u["username"] == update_data["username"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Username already taken"
                )
    
    # Remove password from update (would hash in real app)
    update_data.pop("password", None)
    
    user_dict.update(update_data)
    user_dict["updated_at"] = datetime.utcnow()
    
    return UserResponse(**user_dict)


@router.delete(
    "/{user_id}",
    response_model=MessageResponse,
    status_code=status.HTTP_200_OK,
    summary="Delete User",
    description="Delete a user from the system. This action is permanent and cannot be undone.",
    response_description="Deletion confirmation"
)
async def delete_user(path: UserPathParams = Depends()) -> MessageResponse:
    """
    Delete a user by their ID.
    
    Args:
        path: Path parameters containing user_id.
    
    Returns:
        MessageResponse: Confirmation of deletion.
    
    Raises:
        HTTPException: 404 if user is not found.
    """
    if path.user_id not in _fake_users_db:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with ID {path.user_id} not found"
        )
    
    del _fake_users_db[path.user_id]
    
    return MessageResponse(
        message=f"User {path.user_id} successfully deleted",
        success=True
    )
