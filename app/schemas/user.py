"""
User-related Pydantic schemas.

This module contains all schemas related to user operations including
creation, updates, responses, and query parameters.

All schemas use Pydantic v2 with ConfigDict and Field for automatic
OpenAPI/Swagger documentation generation.
"""

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field, EmailStr, ConfigDict


# =============================================================================
# REQUEST SCHEMAS
# =============================================================================

class UserBase(BaseModel):
    """
    Base user schema with common attributes.
    
    Parent class for create and response schemas containing
    shared field definitions with full documentation.
    """
    model_config = ConfigDict(
        str_strip_whitespace=True,
        validate_assignment=True
    )
    
    email: EmailStr = Field(
        title="Email",
        description="User's email address (must be valid email format)",
        json_schema_extra={"examples": ["john.doe@example.com", "jane@company.org"]}
    )
    username: str = Field(
        min_length=3,
        max_length=50,
        title="Username",
        description="Unique username (3-50 characters, alphanumeric and underscores)",
        json_schema_extra={"examples": ["john_doe", "jane123"]}
    )
    full_name: Optional[str] = Field(
        default=None,
        max_length=100,
        title="Full Name",
        description="User's full display name",
        json_schema_extra={"examples": ["John Doe", "Jane Smith"]}
    )
    is_active: bool = Field(
        default=True,
        title="Is Active",
        description="Whether the user account is active"
    )


class UserCreate(UserBase):
    """
    Schema for creating a new user.
    
    Inherits all fields from UserBase and adds password.
    Used as request body for POST /users endpoint.
    
    Required Fields:
        - email: Valid email address
        - username: Unique username (3-50 chars)
        - password: Password (min 8 chars)
    
    Optional Fields:
        - full_name: Display name
        - is_active: Account status (default: true)
    """
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "email": "john.doe@example.com",
                "username": "john_doe",
                "full_name": "John Doe",
                "is_active": True,
                "password": "securepassword123"
            }
        }
    )
    
    password: str = Field(
        min_length=8,
        max_length=128,
        title="Password",
        description="User's password (minimum 8 characters)",
        json_schema_extra={"examples": ["securepassword123"]}
    )


class UserUpdate(BaseModel):
    """
    Schema for updating an existing user (partial update).
    
    All fields are optional - only provided fields will be updated.
    Used as request body for PATCH /users/{id} endpoint.
    
    Updatable Fields:
        - email: New email address
        - username: New username
        - full_name: New display name
        - is_active: New active status
        - password: New password
    """
    model_config = ConfigDict(
        str_strip_whitespace=True,
        json_schema_extra={
            "example": {
                "full_name": "Jonathan Doe",
                "is_active": True
            }
        }
    )
    
    email: Optional[EmailStr] = Field(
        default=None,
        title="Email",
        description="New email address"
    )
    username: Optional[str] = Field(
        default=None,
        min_length=3,
        max_length=50,
        title="Username",
        description="New username"
    )
    full_name: Optional[str] = Field(
        default=None,
        max_length=100,
        title="Full Name",
        description="New full name"
    )
    is_active: Optional[bool] = Field(
        default=None,
        title="Is Active",
        description="New active status"
    )
    password: Optional[str] = Field(
        default=None,
        min_length=8,
        max_length=128,
        title="Password",
        description="New password"
    )


# =============================================================================
# RESPONSE SCHEMAS
# =============================================================================

class UserResponse(UserBase):
    """
    Schema for user response data.
    
    Extends UserBase with server-generated fields.
    Note: Password is never included in responses.
    
    Additional Fields:
        - id: Unique user identifier (auto-generated)
        - created_at: Account creation timestamp
        - updated_at: Last update timestamp
    """
    model_config = ConfigDict(
        from_attributes=True,
        json_schema_extra={
            "example": {
                "id": 1,
                "email": "john.doe@example.com",
                "username": "john_doe",
                "full_name": "John Doe",
                "is_active": True,
                "created_at": "2025-12-07T10:00:00Z",
                "updated_at": None
            }
        }
    )
    
    id: int = Field(
        title="User ID",
        description="Unique user identifier",
        json_schema_extra={"examples": [1, 42, 100]}
    )
    created_at: datetime = Field(
        title="Created At",
        description="Timestamp when user account was created"
    )
    updated_at: Optional[datetime] = Field(
        default=None,
        title="Updated At",
        description="Timestamp when user was last updated"
    )


class UserListResponse(BaseModel):
    """
    Schema for paginated list of users.
    
    Used as response model for GET /users endpoint.
    
    Fields:
        - users: List of user objects
        - total: Total count of users matching query
        - skip: Number of records skipped
        - limit: Maximum records returned
    """
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "users": [
                    {
                        "id": 1,
                        "email": "john.doe@example.com",
                        "username": "john_doe",
                        "full_name": "John Doe",
                        "is_active": True,
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
    
    users: List[UserResponse] = Field(
        title="Users",
        description="List of user objects"
    )
    total: int = Field(
        title="Total",
        description="Total number of users",
        json_schema_extra={"examples": [100]}
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

class UserFilterParams(BaseModel):
    """
    Query parameters for filtering users.
    
    Use with FastAPI's Depends() for clean endpoint signatures:
    
    ```python
    from fastapi import Depends
    
    @router.get("/users")
    async def list_users(filters: UserFilterParams = Depends()):
        is_active = filters.is_active
    ```
    """
    model_config = ConfigDict(
        json_schema_extra={
            "example": {"is_active": True}
        }
    )
    
    is_active: Optional[bool] = Field(
        default=None,
        title="Active Filter",
        description="Filter users by active status"
    )
    email_contains: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=100,
        title="Email Contains",
        description="Filter users whose email contains this string",
        json_schema_extra={"examples": ["@company.com", "john"]}
    )
    username_contains: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=50,
        title="Username Contains",
        description="Filter users whose username contains this string",
        json_schema_extra={"examples": ["admin", "user"]}
    )


class UserPathParams(BaseModel):
    """
    Path parameters for user endpoints.
    
    Use with FastAPI's Depends() for clean endpoint signatures:
    
    ```python
    from fastapi import Depends
    
    @router.get("/users/{user_id}")
    async def get_user(path: UserPathParams = Depends()):
        user_id = path.user_id
    ```
    """
    model_config = ConfigDict(
        json_schema_extra={
            "example": {"user_id": 1}
        }
    )
    
    user_id: int = Field(
        gt=0,
        title="User ID",
        description="Unique identifier of the user",
        json_schema_extra={"examples": [1, 42, 100]}
    )
