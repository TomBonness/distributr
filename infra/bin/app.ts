import { App } from "aws-cdk-lib";

import { DistributrStack } from "../lib/app-stack.ts";
import { CiStack } from "../lib/ci-stack.ts";

const app = new App();
// Account stays undefined without credentials, so PR synth works env-agnostic.
const env = { account: process.env["CDK_DEFAULT_ACCOUNT"], region: "us-east-1" };

new DistributrStack(app, "distributr", { env, stackName: "distributr", description: "distributr: agent-first news hub" });
// The repo uses GitHub's immutable OIDC subject (owner/repo ids), which survives renames and re-creation squatting.
new CiStack(app, "distributr-ci", {
  env,
  stackName: "distributr-ci",
  subjectPrefix: "repo:TomBonness@105823687/distributr@1446131972",
});
