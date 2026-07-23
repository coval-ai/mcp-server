import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

interface ToolMetadata {
  title: string;
  annotations: ToolAnnotations;
}

export function readOnlyTool(title: string): ToolMetadata {
  return {
    title,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}

export function writeTool(
  title: string,
  { openWorldHint = false }: { openWorldHint?: boolean } = {}
): ToolMetadata {
  return {
    title,
    annotations: {
      title,
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint,
    },
  };
}

export function updateTool(title: string): ToolMetadata {
  return {
    title,
    annotations: {
      title,
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  };
}
