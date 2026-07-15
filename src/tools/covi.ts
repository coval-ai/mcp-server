import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CovalApiClient } from "../client.js";
import { createSuccessResponse } from "../utils/response.js";
import { handleApiError } from "../utils/errors.js";
import { READ_ONLY_TOOL } from "./annotations.js";

const CoviConsultInputSchema = {
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(12000)
    .describe("The question or task to delegate to Covi."),
  conversation: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(12000),
      }),
    )
    .max(12)
    .optional()
    .describe(
      "Optional prior turns needed for the current request. Do not include secrets or API keys.",
    ),
  session_id: z
    .string()
    .regex(/^[A-Za-z0-9._:-]+$/)
    .max(128)
    .optional()
    .describe(
      "Optional stable caller-session identifier. It must not contain customer secrets.",
    ),
};

export function registerCoviTools(server: McpServer, client: CovalApiClient) {
  server.tool(
    "consult_covi",
    "Delegate a read-only Coval evaluation question to Covi. Covi can use Coval playbooks and the authenticated organization's runs, simulations, conversations, metrics, agents, personas, test sets, and dashboards. It cannot create, modify, run, or delete anything.",
    CoviConsultInputSchema,
    READ_ONLY_TOOL,
    async (params) => {
      try {
        const result = await client.consultCovi({
          prompt: params.prompt,
          conversation: params.conversation,
          sessionId: params.session_id,
        });
        return createSuccessResponse({
          contract_version: result.contractVersion,
          request_id: result.requestId,
          mode: result.mode,
          summary: result.summary,
          evidence: result.evidence,
          proposed_actions: result.proposedActions,
        });
      } catch (err) {
        return handleApiError(err);
      }
    },
  );
}
