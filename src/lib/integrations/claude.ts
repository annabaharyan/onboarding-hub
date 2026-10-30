import Anthropic from "@anthropic-ai/sdk";
import { FIELD_MAP, type EmployeeField } from "../fields";

export const claudeConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);
const model = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

export type TicketValidation = {
  fields: Partial<Record<EmployeeField, string | null>>;
  missing: EmployeeField[];
  problems: string[];
  comment: string;
};

/**
 * Asks Claude to extract onboarding fields from a free-form Jira ticket and flag
 * missing or suspicious information. Uses a forced tool call so the output is structured.
 */
export async function validateTicketWithClaude(input: {
  key: string;
  summary: string;
  description: string;
  knownFields: Record<string, string | null>;
  required: EmployeeField[];
  today: string;
}): Promise<TicketValidation> {
  const fieldProps = Object.fromEntries(
    input.required.concat(["firstName", "lastName", "department", "employmentType", "country", "legalEntity"] as EmployeeField[])
      .filter((v, i, a) => a.indexOf(v) === i)
      .map((f) => [f, { type: ["string", "null"], description: FIELD_MAP[f].label + (FIELD_MAP[f].type === "date" ? " in YYYY-MM-DD" : "") }]),
  );
  const res = await getClient().messages.create({
    model: model(),
    max_tokens: 1500,
    system:
      "You validate HR onboarding requests from Jira for an HR operations team. Extract only information that is explicitly present; never invent values. " +
      "Flag fields that are missing, ambiguous, or implausible (e.g. start date in the past or on a weekend, email not on a company domain, manager missing). " +
      "Write the comment to the ticket reporter: short, polite, in English, as a bullet list of what to add or fix. If nothing is missing, the comment is an empty string.",
    tools: [
      {
        name: "report_validation",
        description: "Report extracted onboarding fields and validation results.",
        input_schema: {
          type: "object",
          properties: {
            fields: { type: "object", properties: fieldProps },
            missing: { type: "array", items: { type: "string", enum: input.required } },
            problems: { type: "array", items: { type: "string" } },
            comment: { type: "string" },
          },
          required: ["fields", "missing", "problems", "comment"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "report_validation" },
    messages: [
      {
        role: "user",
        content:
          `Today is ${input.today}. Required fields: ${input.required.join(", ")}.\n\n` +
          `Ticket ${input.key}\nSummary: ${input.summary}\n\nDescription:\n${input.description.slice(0, 12000)}\n\n` +
          `Fields already read from structured Jira fields (may be incomplete):\n${JSON.stringify(input.knownFields, null, 2)}`,
      },
    ],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("Claude returned no structured result");
  const out = block.input as TicketValidation;
  return {
    fields: out.fields ?? {},
    missing: (out.missing ?? []).filter((f) => f in FIELD_MAP),
    problems: out.problems ?? [],
    comment: out.comment ?? "",
  };
}

export async function testClaude(): Promise<string> {
  const res = await getClient().messages.create({ model: model(), max_tokens: 10, messages: [{ role: "user", content: "Reply with OK" }] });
  return `Connected — model ${res.model} responded.`;
}
