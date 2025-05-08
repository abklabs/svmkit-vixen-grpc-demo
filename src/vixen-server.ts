import * as pulumi from "@pulumi/pulumi";
import { remote, types } from "@pulumi/command";
import * as aws from "@pulumi/aws";
import * as tls from "@pulumi/tls";
import * as fs from "fs";
import * as tmp from "tmp";
import * as toml from "@iarna/toml";

import { externalSg, internalSg } from "./network";
import { instance as nodeInstance } from "./validator";
import { GRPC_PORT as YELLOWSTONE_GRPC_PORT } from "./grpc_geyser";

const config = new pulumi.Config("vixen");
const instanceType = config.get("instanceType") ?? "t3.medium";
const instanceArch = config.get("instanceArch") ?? "x86_64";
const imgFrom =
  config.get("docker-payload") ?? "vixen-server/vixen-server.tar.gz";
const tomlFrom = config.get("vixen-toml") ?? "vixen-server/vixen.example.toml";
const VIXEN_PORT = config.getNumber("vixen-port") ?? 9000;

const grpcAddress = nodeInstance.privateIp.apply(
  (ip) => `http://${ip}:${YELLOWSTONE_GRPC_PORT}`,
);

// Setup a local SSH private key, stored inside Pulumi.
export const sshKey = new tls.PrivateKey("vixen-ssh-key", {
  algorithm: "ED25519",
});

const keyPair = new aws.ec2.KeyPair("vixen-keypair", {
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

export const vixenInstance = new aws.ec2.Instance("vixen-server", {
  ami,
  instanceType,
  keyName: keyPair.keyName,
  vpcSecurityGroupIds: [externalSg.id, internalSg.id],
  userData: `#!/bin/bash
set -e  # Exit on error
# Create directory for docker payload
mkdir -p /home/admin
chown admin:admin /home/admin
`,
  tags: {
    Name: `${stackName}-vixen-server`,
  },
});

// Export the public IP of the instance
export const vixenPublicIp = vixenInstance.publicIp;

// Setup docker + copy the docker image to the remote instance
// Don't actually run the docker container until the validator is up and the geyser port is exposed

export const connection = {
  host: vixenInstance.publicDns,
  user: "admin",
  privateKey: sshKey.privateKeyOpenssh,
};

const createDockerCmd = `
# Create directory for docker payload
mkdir -p /home/admin
sudo chown admin:admin /home/admin

# Update system and install Docker
sudo apt-get update -y
sudo apt-get install -y \
    gzip \
    docker.io

# Start and enable Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Add admin user to docker group to run docker without sudo
sudo usermod -aG docker admin
`;

const createDocker = new remote.Command(
  "docker-setup",
  {
    connection,
    create: createDockerCmd,
    triggers: [],
  },
  { dependsOn: [vixenInstance] },
);

// Set up source and target of the docker copy.
const archive = new pulumi.asset.FileArchive(imgFrom);
const imgTo = "/home/admin/";

// Copy the files to the remote.
const dockerCopy = new remote.CopyToRemote(
  "docker-image-copy",
  {
    connection,
    source: archive,
    remotePath: imgTo,
  },
  { dependsOn: createDocker },
);

// We need to update the Vixen.toml file to set the grpc address set up using the ip assigned to the
// validator
function readGrpcSocketSync(newEndpoint: string): string {
  const fileContent: string = fs.readFileSync(tomlFrom, "utf-8");
  const config: any = toml.parse(fileContent); // Using any since TOML config structure isn't strictly defined
  if (!config.yellowstone) {
    config.yellowstone = {};
  }
  config["yellowstone"]["endpoint"] = newEndpoint;
  const updatedToml: string = toml.stringify(config);
  const tmpobj: tmp.FileResult = tmp.fileSync();
  fs.writeFileSync(tmpobj.name, updatedToml, "utf-8");
  return tmpobj.name;
}
const updatedToml = grpcAddress.apply((addr) => readGrpcSocketSync(addr));

const configCopy = new remote.CopyFile(
  "vixen-config-copy",
  {
    connection,
    localPath: updatedToml,
    remotePath: "/home/admin/Vixen.toml",
  },
  { dependsOn: dockerCopy },
);

export const dockerRunCmd = `cd ${imgTo} && \
    gunzip -c vixen-server.tar.gz | docker load && \
    docker run -d \
    -e CONFIG_FILE=/config/Vixen.toml \
    -v /home/admin/Vixen.toml:/config/Vixen.toml \
    -p ${VIXEN_PORT}:${VIXEN_PORT} \
    vixen-server:latest`;
