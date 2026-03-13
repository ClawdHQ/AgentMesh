import { ok, err, Result } from 'neverthrow';
import { NetworkError } from '@agentmesh/shared';

// Anthropic MCP (Model Context Protocol) client
// Registers and invokes tools that the orchestrator AI can call
export class MCPClient {
  private tools: Map<string, MCPTool> = new Map();

  constructor(private readonly serverUrl?: string) {}

  // Register a tool that the AI can invoke
  registerTool(tool: MCPTool): void {
    this.tools.set(tool.name, tool);
  }

  // Invoke a registered tool by name
  async invokeTool(
    name: string,
    params: Record<string, unknown>
  ): Promise<Result<unknown, NetworkError>> {
    const tool = this.tools.get(name);
    if (!tool) {
      return err(new NetworkError(`Tool not found: ${name}`));
    }

    try {
      const result = await tool.execute(params);
      return ok(result);
    } catch (error) {
      return err(new NetworkError(`Tool execution failed: ${String(error)}`));
    }
  }

  // Get all registered tools as MCP tool definitions
  getToolDefinitions(): MCPToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }

  // Get a specific tool
  getTool(name: string): MCPTool | undefined {
    return this.tools.get(name);
  }

  // List all registered tool names
  listTools(): string[] {
    return Array.from(this.tools.keys());
  }
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  input_schema: MCPTool['inputSchema'];
}
