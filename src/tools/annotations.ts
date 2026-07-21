import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

export function readOnlyTool(): ToolAnnotations {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
}

export function writeTool({ openWorldHint = false }: { openWorldHint?: boolean } = {}): ToolAnnotations {
  return {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint,
  };
}

export function updateTool(): ToolAnnotations {
  return {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  };
}
