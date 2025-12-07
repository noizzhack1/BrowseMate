"""
Application configuration settings.

This module contains all configuration settings for the FastAPI application,
using Pydantic's BaseSettings for environment variable management.
"""

from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.
    
    Attributes:
        app_name: The name of the application displayed in docs.
        app_version: Current version of the API.
        app_description: Description shown in Swagger UI.
        debug: Enable debug mode for development.
        api_prefix: Prefix for all API routes.
    """
    
    app_name: str = "BrowseMate API"
    app_version: str = "1.0.0"
    app_description: str = """
## BrowseMate API

A modern FastAPI application with comprehensive documentation.

### Features:
* 🚀 Fast and async endpoints
* 📝 Auto-generated Swagger documentation
* ✅ Request/Response validation with Pydantic
* 🔒 Ready for authentication integration
    """
    debug: bool = True
    api_prefix: str = "/api/v1"
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    """
    Get cached application settings.
    
    Returns:
        Settings: Application configuration instance.
    """
    return Settings()

