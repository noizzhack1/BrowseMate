from fastmcp import FastMCP
import uvicorn

# Initialize the MCP server
mcp = FastMCP("Demo Python Server")

@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two numbers"""
    return a + b

@mcp.tool()
def echo(message: str) -> str:
    """Echo a message back"""
    return f"Echo: {message}"

@mcp.resource("greeting://{name}")
def get_greeting(name: str) -> str:
    """Get a personalized greeting"""
    return f"Hello, {name}!"

if __name__ == "__main__":
    # Run the server using uvicorn directly if needed, or let fastmcp handle it
    # FastMCP's run method with transport='sse' sets up the SSE endpoint
    print("Starting MCP server on http://localhost:8000/sse")
    mcp.run(transport="sse", port=8000)