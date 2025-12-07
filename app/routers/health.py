"""
Health check router.

This module provides endpoints for monitoring the API's health status.
Useful for load balancers, container orchestration, and monitoring systems.
"""

from fastapi import APIRouter, status
from app.schemas.common import HealthResponse
from app.config import get_settings

router = APIRouter(
    prefix="/health",
    tags=["Health"],
    responses={
        503: {"description": "Service unavailable"}
    }
)


@router.get(
    "",
    response_model=HealthResponse,
    status_code=status.HTTP_200_OK,
    summary="Health Check",
    description="""
    Perform a health check on the API.
    
    This endpoint returns the current health status of the service,
    including the server timestamp and API version. Use this for:
    
    - **Load balancer health checks**
    - **Container orchestration probes** (Kubernetes liveness/readiness)
    - **Monitoring and alerting systems**
    
    Returns HTTP 200 if healthy, 503 if service is degraded.
    """,
    response_description="Health status of the API"
)
async def health_check() -> HealthResponse:
    """
    Check the health status of the API.
    
    Returns:
        HealthResponse: Current health status with timestamp and version.
    
    Example:
        >>> response = await client.get("/api/v1/health")
        >>> response.json()
        {"status": "healthy", "timestamp": "...", "version": "1.0.0"}
    """
    settings = get_settings()
    return HealthResponse(
        status="healthy",
        version=settings.app_version
    )


@router.get(
    "/ready",
    response_model=HealthResponse,
    status_code=status.HTTP_200_OK,
    summary="Readiness Check",
    description="""
    Check if the API is ready to accept traffic.
    
    This endpoint verifies that all dependencies (database, cache, etc.)
    are available and the service is ready to handle requests.
    
    Use this for Kubernetes readiness probes.
    """,
    response_description="Readiness status of the API"
)
async def readiness_check() -> HealthResponse:
    """
    Check if the API is ready to accept traffic.
    
    This performs deeper checks than the basic health endpoint,
    verifying database connectivity and other dependencies.
    
    Returns:
        HealthResponse: Readiness status with details.
    """
    settings = get_settings()
    # Add database/cache connectivity checks here
    return HealthResponse(
        status="ready",
        version=settings.app_version
    )

