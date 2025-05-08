import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const stackName = pulumi.getStack();

export const externalSg = new aws.ec2.SecurityGroup("external-access", {
  description: "Allow external SSH access to all of the nodes",
  ingress: [
    {
      protocol: "tcp",
      fromPort: 0,
      toPort: 22,
      cidrBlocks: ["0.0.0.0/0"],
    },
    // { protocol: "tcp", fromPort: VIXEN_PORT, toPort: VIXEN_PORT, cidrBlocks: ["0.0.0.0/0"] },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
  tags: {
    Stack: stackName,
  },
});

export const internalSg = new aws.ec2.SecurityGroup("internal-access", {
  description: "Permissive internal traffic",
  ingress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      self: true,
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
  tags: {
    Stack: stackName,
  },
});
