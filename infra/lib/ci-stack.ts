/**
 * GitHub Actions OIDC deploy role. Only pushes to main can assume it (fork PRs
 * never get id-token); it can do nothing but assume the CDK bootstrap roles.
 */
import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import { OidcProviderNative, PolicyStatement, Role, WebIdentityPrincipal } from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

export interface CiStackProps extends StackProps {
  /** owner/name */
  repo: string;
}

export class CiStack extends Stack {
  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);

    const provider = new OidcProviderNative(this, "GitHubOidc", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });

    const role = new Role(this, "DeployRole", {
      roleName: "distributr-github-deploy",
      assumedBy: new WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": `repo:${props.repo}:ref:refs/heads/main`,
        },
      }),
      maxSessionDuration: Duration.hours(1),
    });
    role.addToPolicy(
      new PolicyStatement({
        actions: ["sts:AssumeRole", "sts:TagSession"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`],
      }),
    );

    new CfnOutput(this, "DeployRoleArn", { value: role.roleArn });
  }
}
