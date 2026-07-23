import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

interface ToolMetadata {
  title: string;
  annotations: ToolAnnotations;
}

export type ToolAnnotationProfile = 'standard' | 'claude';

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

export function createTool(
  title: string,
  {
    annotationProfile = 'standard',
    irreversible = false,
    openWorldHint = false,
  }: {
    annotationProfile?: ToolAnnotationProfile;
    irreversible?: boolean;
    openWorldHint?: boolean;
  } = {}
): ToolMetadata {
  return {
    title,
    annotations: {
      title,
      readOnlyHint: false,
      destructiveHint: irreversible || annotationProfile === 'claude',
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
