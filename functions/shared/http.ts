import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export type HttpResult = APIGatewayProxyStructuredResultV2 & { statusCode: number; headers: Record<string, string> };

export function bodyText(event: APIGatewayProxyEventV2): string {
  if (!event.body) return "";
  return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
}

export function text(status: number, body: string, contentType: string): HttpResult {
  return { statusCode: status, headers: { "content-type": contentType }, body };
}

export function json(status: number, body: unknown): HttpResult {
  return text(status, JSON.stringify(body), "application/json; charset=utf-8");
}

export function html(status: number, body: string): HttpResult {
  return text(status, body, "text/html; charset=utf-8");
}
