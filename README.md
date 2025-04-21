# Solana Single Validator SPE with Yellowstone GRPC plugin

This example brings up a private cluster containing a single Solana validator running a `yellowstone-grpc` geyser. It also brings up a seperate `vixen-stream` grpc server that subscribes to the geyser stream,
parses the data into TokenExtension updates, and makes them available over a gRPC endpoint. It also contains a `vixen-client` directory that you can use to demo the rpc + grpc-server spun up.
## Demo Video
[![Watch the demo](https://img.youtube.com/vi/8vh38ky_69U/maxresdefault.jpg)](https://www.youtube.com/watch?v=8vh38ky_69U)


## Dependencies for demo
- pulumi
- docker
- rustc + cargo
- node + npm
- gzip
- protoc

## Running the Example

0. Have `pulumi` installed, logged in to wherever you're storing state, and configured to work with AWS.

- https://www.pulumi.com/docs/iac/cli/commands/pulumi_login/
- https://github.com/pulumi/pulumi-aws?tab=readme-ov-file#configuration

1. Run `pulumi install`; this will install all of the required pieces for this example.

```
% pulumi install
```

2. Create and select a Pulumi stack

```
% pulumi stack init dev-node-grpc
```

3. Build the vixen-stream docker image

This builds the docker image for running your custom vixen-stream server. We target `linux/amd64` to
ensure that the image can run on the AWS instance even if it is built on an M1 mac. Note that the
`platform` flag only exists on relatively newer versions of the `docker` cli. If you have an older
version of docker without the option, but are already on an amd64 host, you can skip the platform
flags and subsequent values for both the commands below

```
% cd vixen-server
% docker build --platform linux/amd64 -t vixen-server .
% docker save --platform linux/amd64 vixen-server:latest| gzip >> vixen-server.tar.gz
% cd ../
```
You have now created a `vixen-server.tar.gz` file. Use this path when setting the
`vixen:docker-payload` config value.

4. Set pulumi config
Use `pulumi config set <key:val>` to set the following configuration values (or just use the
defaults):

| Name                       | Description                                                       | Default Value                    |
| :------------------------- | :---------------------------------------------------------------- |:-------------------------------- |
| aws:region                 | The AWS region to launch the cluster in.                          | us-east-1
| vixen:docker-payload       | The path to the vixen-server docker image tarball.                | vixen-server.tar.gz
| vixen:vixen-toml           | The path to the vixen.toml file.                                  | vixen-server/vixen.example.toml
| vixen:vixen-port           | The port to run the vixen server on.                              | 9000
| validator:instanceType     | The AWS instance type to use for all of the nodes.                | t3.2xlarge
| validator:instanceArch     | The AWS instance architecture type to use for the AMI lookup.     | x86_64
| yellowstone:grpc-port      | The port to run the yellowstone gRPC server on                    | 10000


One thing worth noting is that because the ip address of the validator is unknown prior to spinning
up the cluster, we update the address of the grpc server in the vixen.toml file after the cluster is
up.

5. Run `pulumi up`

```
% pulumi up
```

6. Port forward to the vixen docker container and the solana rpc


In one terminal:
```
./ssh-to-host 1 -L 9000:localhost:9000
```
in another:

```
./ssh-to-host 0 -L 8899:localhost:8899
```
Finally, in a third terminal:
```
cd vixen-client
cargo run --release
```
This program will run two tasks in parallel. The first simulates a client creating a token and two token accounts. The
second task subscribes to the vixen stream and prints out the updates it receives.
The logs you will see either have a `Mint Token` label which shows actions from the first task, or a `Vixen Streaming Client` label which show updates from the vixen-stream.

NOTE: It currently only runs a single mint, but we keep the stream open. Feel free to manually
run token options with `spl-token` on port 8899 to continue to see the updates in the stream. When
you are ready to exit the stream simply hit `ctrl-c` in the terminal running the vixen-client.

8. (Optional) Tear down the example

```bash
% pulumi down
```
