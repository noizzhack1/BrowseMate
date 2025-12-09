from fastmcp import FastMCP
import logging

# Set up detailed logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("mcp-server")

# Initialize the MCP server
mcp = FastMCP("Demo Python Server")

@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two numbers"""
    logger.info(f"=== TOOL CALLED: add ===")
    logger.info(f"Parameters: a={a}, b={b}")
    result = a + b
    logger.info(f"Result: {result}")
    print(f"\n*** ADD TOOL EXECUTED: {a} + {b} = {result} ***\n")
    return result

@mcp.tool()
def divide(x: int, y: int) -> int:
    """Divide x by y"""
    logger.info(f"=== TOOL CALLED: divide ===")
    logger.info(f"Parameters: x={x}, y={y}")
    result = x / y
    logger.info(f"Result: {result}")
    print(f"\n*** DIVIDE TOOL EXECUTED: '{x} / {y} = {result}' ***\n")
    return result

    
@mcp.tool()
def echo(message: str) -> str:
    """Echo a message back"""
    logger.info(f"=== TOOL CALLED: echo ===")
    logger.info(f"Parameters: message={message}")
    result = f"Echo: {message}"
    logger.info(f"Result: {result}")
    print(f"\n*** ECHO TOOL EXECUTED: '{message}' ***\n")
    return result

@mcp.resource("greeting://{name}")
def get_greeting(name: str) -> str:
    """Get a personalized greeting"""
    logger.info(f"=== RESOURCE CALLED: greeting ===")
    logger.info(f"Parameters: name={name}")
    return f"Hello, {name}!"

if __name__ == "__main__":
    # Run the server using streamable HTTP transport for simpler JSON-RPC handling
    # This exposes /mcp endpoint for POST requests
    print("=" * 60)
    print("Starting MCP server on http://localhost:8000/mcp")
    print("Available tools: add(a, b), echo(message)")
    print("=" * 60)
    mcp.run(transport="streamable-http", host="127.0.0.1", port=8000)