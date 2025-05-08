import * as pulumi from "@pulumi/pulumi";
import { remote, types } from "@pulumi/command";
import * as svmkit from "@svmkit/pulumi-svmkit";

import { sshKey, instance } from "./validator";
import { geyserPluginArgs } from "./grpc_geyser";
import {
  vixenInstance,
  sshKey as vixenSshKey,
  connection as vixenConnection,
  dockerRunCmd,
} from "./vixen-server";

const RPC_PORT = 8899;
const GOSSIP_PORT = 8001;
const FAUCET_PORT = 9900;

// Note: It's very important that the agave version and the grpc geyser plugin version are
// compatible
const AGAVE_VERSION = "2.2.1-1";

// Create some keys for this validator to use.
const validatorKey = new svmkit.KeyPair("validator-key");
const voteAccountKey = new svmkit.KeyPair("vote-account-key");
const faucetKey = new svmkit.KeyPair("faucet-key");
const treasuryKey = new svmkit.KeyPair("treasury-key");
const stakeAccountKey = new svmkit.KeyPair("stake-account-key");

// Point pulumi-svmkit at the AWS EC2 instance's SSH connection.
const connection = {
  host: instance.publicDns,
  user: "admin",
  privateKey: sshKey.privateKeyOpenssh,
};

// Add the genesis configuration before the Agave instance
const genesis = new svmkit.genesis.Solana(
  "genesis",
  {
    connection,
    version: AGAVE_VERSION,
    flags: {
      bootstrapValidators: [
        {
          identityPubkey: validatorKey.publicKey,
          votePubkey: voteAccountKey.publicKey,
          stakePubkey: stakeAccountKey.publicKey,
        },
      ],
      ledgerPath: "/home/sol/ledger",
      faucetPubkey: faucetKey.publicKey,
      bootstrapValidatorStakeLamports: 10000000000, // 10 SOL
      enableWarmupEpochs: true,
      slotsPerEpoch: 8192,
    },
    primordial: [
      {
        pubkey: validatorKey.publicKey,
        lamports: 1000000000000, // 1000 SOL
      },
      {
        pubkey: treasuryKey.publicKey,
        lamports: 100000000000000, // 100000 SOL
      },
      {
        pubkey: faucetKey.publicKey,
        lamports: 1000000000000, // 1000 SOL
      },
    ],
  },
  {
    dependsOn: [instance],
  },
);

const faucet = new svmkit.faucet.Faucet(
  "bootstrap-faucet",
  { connection: connection, keypair: faucetKey.json, flags: {} },
  { dependsOn: [genesis] },
);

// Create the environment configuration
const solEnv = {
  rpcURL: instance.privateIp.apply((ip) => `http://${ip}:${RPC_PORT}`),
};

// Update the rpcFaucetAddress definition
const rpcFaucetAddress = instance.privateIp.apply(
  (ip) => `${ip}:${FAUCET_PORT}`,
);

// Update the Agave instance configuration
const validator = new svmkit.validator.Agave(
  "validator",
  {
    connection,
    version: AGAVE_VERSION,
    environment: solEnv,
    startupPolicy: { waitForRPCHealth: true },
    shutdownPolicy: { force: true },
    keyPairs: {
      identity: validatorKey.json,
      voteAccount: voteAccountKey.json,
    },
    geyserPlugin: geyserPluginArgs,
    flags: {
      onlyKnownRPC: false,
      rpcPort: RPC_PORT,
      dynamicPortRange: "8002-8020",
      privateRPC: false,
      gossipPort: GOSSIP_PORT,
      rpcBindAddress: "0.0.0.0",
      walRecoveryMode: "skip_any_corrupted_record",
      limitLedgerSize: 50000000,
      blockProductionMethod: "central-scheduler",
      fullSnapshotIntervalSlots: 1000,
      noWaitForVoteToStartLeader: true,
      useSnapshotArchivesAtStartup: "when-newest",
      allowPrivateAddr: true,
      rpcFaucetAddress: rpcFaucetAddress,
      fullRpcAPI: true,
      noVoting: false,
    },
  },
  {
    dependsOn: [faucet],
  },
);

// Tuner setup
const tunerVariant = svmkit.tuner.TunerVariant.Generic;

// Retrieve the default tuner parameters for that variant
const genericTunerParamsOutput = svmkit.tuner.getDefaultTunerParamsOutput({
  variant: tunerVariant,
});

const tunerParams = genericTunerParamsOutput.apply((p) => ({
  cpuGovernor: p.cpuGovernor,
  kernel: p.kernel,
  net: p.net,
  vm: p.vm,
  fs: p.fs,
}));

// Create the Tuner resource on the EC2 instance
const tuner = new svmkit.tuner.Tuner(
  "tuner",
  {
    connection,
    params: tunerParams,
  },
  {
    dependsOn: [instance],
  },
);

const dockerRun = new remote.Command(
  "docker-run",
  {
    connection: vixenConnection,
    create: dockerRunCmd,
  },
  { dependsOn: [validator] },
);

// Expose information required to SSH to the validator host.
export const nodes_name = ["validator", "vixenInstance"];
export const nodes_public_ip = [instance.publicIp, vixenInstance.publicIp];
export const nodes_private_key = [
  sshKey.privateKeyOpenssh,
  vixenSshKey.privateKeyOpenssh,
];
