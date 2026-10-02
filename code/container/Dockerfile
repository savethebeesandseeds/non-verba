# syntax=docker/dockerfile:1
FROM debian:13-slim@sha256:7792b1f7702a86946cd518db72b6a407302c3e9bc1635634368b878189e8221c

ENV NONVERBA_CONTAINER=1 \
    NONVERBA_GPU=cuda \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility
ARG NONVERBA_IMAGE_BUILD=1
ARG NONVERBA_CUDA_ARCHITECTURES=86
WORKDIR /workspace/code
COPY setup.sh dev.sh ./
COPY container/env.sh container/debian-packages.lock container/cuda-packages.lock ./container/
COPY tools/check-gpu.cpp ./tools/
# Existing accepted Android SDK license record is supplied as a build secret.
# No private signing keys or project application source enter the build context.
# Cache the existing toolchain separately from the CUDA compilation.
RUN --mount=type=secret,id=android_license,required=true \
    NONVERBA_GPU=none bash setup.sh
RUN --mount=type=secret,id=android_license,required=true \
    bash setup.sh
RUN bash dev.sh health && \
    /usr/local/cuda-13.1/bin/nvcc --version && \
    /usr/local/cuda-13.1/bin/nvcc -x cu tools/check-gpu.cpp -arch=sm_${NONVERBA_CUDA_ARCHITECTURES} -o /usr/local/bin/nonverba-check-gpu && \
    ! command -v python3 && \
    test -x /usr/local/lib/nonverba/llama.cpp/14a9d09f75683c94c2c4f229efe54670d4209089/build-cuda/bin/llama-server
CMD ["sleep", "infinity"]
