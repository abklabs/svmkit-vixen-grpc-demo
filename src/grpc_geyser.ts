import * as pulumi from "@pulumi/pulumi";
import * as svmkit from "@svmkit/pulumi-svmkit";

const config = new pulumi.Config("yellowstone");
export const GRPC_PORT = config.getNumber("grpc-port") ?? 10000;

export const geyserPluginArgs: svmkit.types.input.geyser.GeyserPluginArgs = {
    yellowstoneGRPC: {
        version: "6.0.0+solana.2.2.1",
        config: {
            grpc: {
                address: `0.0.0.0:${GRPC_PORT}`,
            },
            log: {
                level: "info"
            },
            tokio : {
                workerThreads : 4,
                affinity : [],
            }
        }
    }
}
