import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as tls from "@pulumi/tls";
import * as fs from "fs";

import { externalSg, internalSg } from "./network";

const validatorConfig = new pulumi.Config("validator");
const instanceType = validatorConfig.get("instanceType") ?? "t3.2xlarge";
const instanceArch = validatorConfig.get("instanceArch") ?? "x86_64";

// Setup a local SSH private key, stored inside Pulumi.
export const sshKey = new tls.PrivateKey("ssh-key", {
  algorithm: "ED25519",
});

const keyPair = new aws.ec2.KeyPair("keypair", {
  publicKey: sshKey.publicKeyOpenssh,
});

// Get AMI information on the latest Debian image inside AWS.
const ami = pulumi.output(
  aws.ec2.getAmi({
    filters: [
      {
        name: "name",
        values: ["debian-12-*"],
      },
      {
        name: "architecture",
        values: [instanceArch],
      },
    ],
    owners: ["136693071363"], // Debian
    mostRecent: true,
  }),
).id;

const stackName = pulumi.getStack();

export const instance = new aws.ec2.Instance("instance", {
  ami,
  instanceType,
  keyName: keyPair.keyName,
  vpcSecurityGroupIds: [externalSg.id, internalSg.id],
  ebsBlockDevices: [
    {
      deviceName: "/dev/sdf",
      volumeSize: 100,
      volumeType: "gp3",
      iops: 5000,
    },
    {
      deviceName: "/dev/sdg",
      volumeSize: 204,
      volumeType: "gp3",
      iops: 5000,
    },
  ],
  userData: `#!/bin/bash
# Format the /dev/sdf and /dev/sdg devices with the ext4 filesystem.
mkfs -t ext4 /dev/sdf
mkfs -t ext4 /dev/sdg

# Create directories for Solana accounts and ledger data.
mkdir -p /home/sol/accounts
mkdir -p /home/sol/ledger

# Append entries to /etc/fstab to mount the devices and swap at boot.
cat <<EOF >> /etc/fstab
/dev/sdf	/home/sol/accounts	ext4	defaults	0	0
/dev/sdg	/home/sol/ledger	ext4	defaults	0	0
/swapfile none swap sw 0 0
EOF

# Setup swap space
fallocate -l {swap_size}M /swapfile
chmod 600 /swapfile
mkswap /swapfile

# Reload systemd manager configuration and mount all filesystems.
systemctl daemon-reload
mount -a
swapon -a
`,
  tags: {
    Name: `${pulumi.getStack()}-validator`,
  },
});

export const connection = {
  host: instance.publicDns,
  user: "admin",
  privateKey: sshKey.privateKeyOpenssh,
};
