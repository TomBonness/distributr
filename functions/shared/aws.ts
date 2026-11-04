/**
 * Real AWS adapters. The only file that builds SDK clients; everything else
 * takes Deps, so tests inject in-memory fakes.
 */
import { BedrockRuntimeClient, ConverseCommand, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import {
  PutVectorsCommand,
  QueryVectorsCommand,
  S3VectorsClient,
  type QueryVectorsCommandInput,
} from "@aws-sdk/client-s3vectors";

import {
  EMBED_DIM,
  EMBED_MODEL_ID,
  GSI_BY_CATEGORY,
  GSI_BY_RECENCY,
  LLM_MODEL_ID,
  T_CONTROL,
  T_STORIES,
  T_SUBMISSIONS,
  VECTOR_BUCKET,
  VECTOR_INDEX,
} from "./config.ts";
import type { Ai, ControlStore, Deps, StoryStore, SubmissionStore, VectorIndex } from "./deps.ts";
import { BadRequest, StoryConflict, UpstreamError } from "./errors.ts";
import { REPORT_TOOL } from "./prompt.ts";
import type { Story } from "./types.ts";

let _doc: DynamoDBDocumentClient | undefined;
function doc(): DynamoDBDocumentClient {
  if (!_doc) {
    _doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return _doc;
}

let _vectors: S3VectorsClient | undefined;
function vectorsClient(): S3VectorsClient {
  if (!_vectors) _vectors = new S3VectorsClient({});
  return _vectors;
}

let _bedrock: BedrockRuntimeClient | undefined;
function bedrock(): BedrockRuntimeClient {
  if (!_bedrock) _bedrock = new BedrockRuntimeClient({ requestHandler: { requestTimeout: 20000 } });
  return _bedrock;
}

function isConditionalFail(e: unknown): boolean {
  return (e as Error | undefined)?.name === "ConditionalCheckFailedException";
}

function decodeCursor(cursor: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new BadRequest("invalid cursor");
}

const storyStore: StoryStore = {
  async get(id) {
    const r = await doc().send(new GetCommand({ TableName: T_STORIES, Key: { id } }));
    return r.Item as Story | undefined;
  },
  async getMany(ids) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const out: Story[] = [];
    let keys: Record<string, unknown>[] | undefined = unique.map((id) => ({ id }));
    for (let attempt = 0; keys && keys.length > 0 && attempt <= 3; attempt++) {
      const r = await doc().send(new BatchGetCommand({ RequestItems: { [T_STORIES]: { Keys: keys } } }));
      out.push(...((r.Responses?.[T_STORIES] ?? []) as Story[]));
      keys = r.UnprocessedKeys?.[T_STORIES]?.Keys as Record<string, unknown>[] | undefined;
    }
    return out;
  },
  async create(s) {
    await doc().send(
      new PutCommand({ TableName: T_STORIES, Item: s, ConditionExpression: "attribute_not_exists(id)" }),
    );
  },
  async replace(s, expectedVersion) {
    try {
      await doc().send(
        new PutCommand({
          TableName: T_STORIES,
          Item: s,
          ConditionExpression: "#v = :prev",
          ExpressionAttributeNames: { "#v": "version" },
          ExpressionAttributeValues: { ":prev": expectedVersion },
        }),
      );
    } catch (e) {
      if (isConditionalFail(e)) throw new StoryConflict();
      throw e;
    }
  },
  async latest({ category, limit, cursor }) {
    const input: QueryCommandInput = category
      ? {
          TableName: T_STORIES,
          IndexName: GSI_BY_CATEGORY,
          KeyConditionExpression: "#c = :cat",
          ExpressionAttributeNames: { "#c": "category" },
          ExpressionAttributeValues: { ":cat": category },
        }
      : {
          TableName: T_STORIES,
          IndexName: GSI_BY_RECENCY,
          KeyConditionExpression: "#k = :story",
          ExpressionAttributeNames: { "#k": "kind" },
          ExpressionAttributeValues: { ":story": "story" },
        };
    input.ScanIndexForward = false;
    input.Limit = limit;
    if (cursor) input.ExclusiveStartKey = decodeCursor(cursor);
    const r = await doc().send(new QueryCommand(input));
    return {
      stories: (r.Items ?? []) as Story[],
      cursor: r.LastEvaluatedKey ? Buffer.from(JSON.stringify(r.LastEvaluatedKey)).toString("base64url") : undefined,
    };
  },
};

const submissionStore: SubmissionStore = {
  async claim(sub) {
    try {
      await doc().send(
        new PutCommand({ TableName: T_SUBMISSIONS, Item: sub, ConditionExpression: "attribute_not_exists(id)" }),
      );
      return true;
    } catch (e) {
      if (isConditionalFail(e)) return false;
      throw e;
    }
  },
  async finish(id, patch) {
    const names: Record<string, string> = { "#s": "status" };
    const values: Record<string, unknown> = { ":s": patch.status };
    const sets = ["#s = :s"];
    if (patch.storyId !== undefined) {
      names["#sid"] = "storyId";
      values[":sid"] = patch.storyId;
      sets.push("#sid = :sid");
    }
    if (patch.reason !== undefined) {
      names["#r"] = "reason";
      values[":r"] = patch.reason;
      sets.push("#r = :r");
    }
    await doc().send(
      new UpdateCommand({
        TableName: T_SUBMISSIONS,
        Key: { id },
        UpdateExpression: "SET " + sets.join(", "),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  },
};

const controlStore: ControlStore = {
  async consume(counterPk, limit, expiresAt) {
    try {
      await doc().send(
        new UpdateCommand({
          TableName: T_CONTROL,
          Key: { pk: counterPk },
          UpdateExpression: "ADD #n :one SET #e = :exp",
          ConditionExpression: "attribute_not_exists(#n) OR #n < :limit",
          ExpressionAttributeNames: { "#n": "count", "#e": "expiresAt" },
          ExpressionAttributeValues: { ":one": 1, ":exp": expiresAt, ":limit": limit },
        }),
      );
      return true;
    } catch (e) {
      if (isConditionalFail(e)) return false;
      throw e;
    }
  },
};

const vectorIndex: VectorIndex = {
  async query(vector, topK, filter) {
    const r = await vectorsClient().send(
      new QueryVectorsCommand({
        vectorBucketName: VECTOR_BUCKET,
        indexName: VECTOR_INDEX,
        queryVector: { float32: vector },
        topK,
        filter: filter as QueryVectorsCommandInput["filter"],
        returnDistance: true,
      }),
    );
    return (r.vectors ?? []).flatMap((v) => (v.key ? [{ id: v.key, distance: v.distance ?? 1 }] : []));
  },
  async put(id, vector, metadata) {
    await vectorsClient().send(
      new PutVectorsCommand({
        vectorBucketName: VECTOR_BUCKET,
        indexName: VECTOR_INDEX,
        vectors: [{ key: id, data: { float32: vector }, metadata }],
      }),
    );
  },
};

const ai: Ai = {
  async embed(text) {
    const r = await bedrock().send(
      new InvokeModelCommand({
        modelId: EMBED_MODEL_ID,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({ inputText: text.slice(0, 20000), dimensions: EMBED_DIM, normalize: true }),
      }),
    );
    const parsed = JSON.parse(new TextDecoder().decode(r.body)) as { embedding?: number[] };
    if (!Array.isArray(parsed.embedding)) throw new UpstreamError("embedding model returned no vector");
    return parsed.embedding;
  },
  async fileReport(system, user) {
    const r = await bedrock().send(
      new ConverseCommand({
        modelId: LLM_MODEL_ID,
        system: [{ text: system }],
        messages: [{ role: "user", content: [{ text: user }] }],
        toolConfig: {
          tools: [{ toolSpec: REPORT_TOOL as never }],
          toolChoice: { tool: { name: REPORT_TOOL.name } },
        },
        inferenceConfig: { maxTokens: 1500, temperature: 0 },
      }),
    );
    for (const block of r.output?.message?.content ?? []) {
      if (block.toolUse) return block.toolUse.input;
    }
    throw new UpstreamError("editor returned no file_report call");
  },
};

let _deps: Deps | undefined;
export function realDeps(): Deps {
  if (!_deps) {
    _deps = {
      stories: storyStore,
      submissions: submissionStore,
      control: controlStore,
      vectors: vectorIndex,
      ai,
      now: () => new Date(),
    };
  }
  return _deps;
}
