#!/usr/bin/env bash
set -euo pipefail
# Run from the repository root. The optional Java mode downloads Temurin images.
if [[ "${1:-}" == "--java" ]]; then
  docker build -t mcm-manager-java-test-runtime:local testdata/java-runtime
  mkdir -p target/docker-fixture
  docker run --rm --entrypoint cat mcm-manager-java-test-runtime:local /fixture.jar > target/docker-fixture/server.jar
  export CHUNKYARD_TEST_DOCKER_IMAGE=mcm-manager-java-test-runtime:local
  export CHUNKYARD_TEST_SERVER_JAR="$PWD/target/docker-fixture/server.jar"
else
  docker build -t mcm-manager-test-runtime:local testdata/docker-runtime
fi
cargo test -p mcm-api-tests --test docker_live --locked -- --ignored --nocapture
