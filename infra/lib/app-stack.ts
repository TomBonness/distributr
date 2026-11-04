/**
 * distributr: 3 DynamoDB tables, 1 S3 Vectors index, 2 Lambdas (api, feeds),
 * a throttled HTTP API $default stage, and a 2-hourly feeds schedule.
 */
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { CorsHttpMethod, HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AttributeType, BillingMode, Table, TableEncryption, type TableProps } from "aws-cdk-lib/aws-dynamodb";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { CfnIndex, CfnVectorBucket } from "aws-cdk-lib/aws-s3vectors";
import type { Construct } from "constructs";
import { join } from "node:path";

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
} from "../../functions/shared/config.ts";

export class DistributrStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const tableBase: Partial<TableProps> = {
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.DEFAULT,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    };
    const stories = new Table(this, "Stories", {
      ...tableBase,
      tableName: T_STORIES,
      partitionKey: { name: "id", type: AttributeType.STRING },
    });
    stories.addGlobalSecondaryIndex({
      indexName: GSI_BY_CATEGORY,
      partitionKey: { name: "category", type: AttributeType.STRING },
      sortKey: { name: "updatedAt", type: AttributeType.STRING },
    });
    stories.addGlobalSecondaryIndex({
      indexName: GSI_BY_RECENCY,
      partitionKey: { name: "kind", type: AttributeType.STRING },
      sortKey: { name: "updatedAt", type: AttributeType.STRING },
    });
    const submissions = new Table(this, "Submissions", {
      ...tableBase,
      tableName: T_SUBMISSIONS,
      partitionKey: { name: "id", type: AttributeType.STRING },
      timeToLiveAttribute: "expiresAt",
    });
    const control = new Table(this, "Control", {
      ...tableBase,
      tableName: T_CONTROL,
      partitionKey: { name: "pk", type: AttributeType.STRING },
      timeToLiveAttribute: "expiresAt",
    });

    const vectorBucket = new CfnVectorBucket(this, "Vectors", { vectorBucketName: VECTOR_BUCKET });
    const index = new CfnIndex(this, "StoriesIndex", {
      vectorBucketArn: vectorBucket.attrVectorBucketArn,
      indexName: VECTOR_INDEX,
      dataType: "float32",
      dimension: EMBED_DIM,
      distanceMetric: "cosine",
    });

    // esbuild emits CJS: code under functions/ must not use import.meta or top-level await.
    const fn = (name: string, file: string, memorySize: number, timeout: Duration): NodejsFunction =>
      new NodejsFunction(this, name, {
        functionName: name,
        entry: join(import.meta.dirname, "..", "..", "functions", file),
        handler: "handler",
        runtime: Runtime.NODEJS_24_X,
        architecture: Architecture.ARM_64,
        memorySize,
        timeout,
        // Bundle the AWS SDK too, so S3 Vectors doesn't depend on the runtime's SDK version.
        bundling: { externalModules: [] },
        logGroup: new LogGroup(this, `${name}-logs`, {
          logGroupName: `/aws/lambda/${name}`,
          retention: RetentionDays.TWO_WEEKS,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
      });
    // 28 s stays under the 30 s HTTP API integration limit.
    const apiFn = fn("distributr-api", "api.ts", 1024, Duration.seconds(28));
    const feedsFn = fn("distributr-feeds", "feeds.ts", 512, Duration.minutes(10));

    for (const f of [apiFn, feedsFn]) {
      for (const t of [stories, submissions, control]) t.grantReadWriteData(f);
      f.addToRolePolicy(
        new PolicyStatement({
          actions: ["bedrock:InvokeModel"],
          resources: [
            `arn:aws:bedrock:us-east-1::foundation-model/${LLM_MODEL_ID}`,
            `arn:aws:bedrock:us-east-1::foundation-model/${EMBED_MODEL_ID}`,
          ],
        }),
      );
      f.addToRolePolicy(
        new PolicyStatement({
          // Filtered queries need GetVectors as well as QueryVectors.
          actions: ["s3vectors:QueryVectors", "s3vectors:GetVectors", "s3vectors:PutVectors"],
          resources: [index.attrIndexArn],
        }),
      );
    }

    const api = new HttpApi(this, "Api", {
      apiName: "distributr",
      defaultIntegration: new HttpLambdaIntegration("ApiIntegration", apiFn),
      createDefaultStage: false,
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.DELETE, CorsHttpMethod.OPTIONS],
        allowHeaders: ["*"],
        exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
        maxAge: Duration.hours(1),
      },
    });
    api.addStage("DefaultStage", { stageName: "$default", autoDeploy: true, throttle: { rateLimit: 10, burstLimit: 20 } });
    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });

    new Rule(this, "FeedsSchedule", {
      ruleName: "distributr-feeds",
      schedule: Schedule.rate(Duration.hours(2)),
      targets: [new LambdaFunction(feedsFn, { retryAttempts: 0 })],
    });
  }
}
