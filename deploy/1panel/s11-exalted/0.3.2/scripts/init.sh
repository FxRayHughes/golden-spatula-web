#!/bin/bash

# Generated from official installation evidence:
# - Dockerfile: FROM gcr.io/distroless/static-debian12:nonroot (UID/GID 65532), DATA_DIR=/data

# Adjust host-mounted data directory permissions for the container runtime user.
if [ -d data ]; then
    chown -R 65532:65532 data
    chmod -R 700 data
fi
