// SPDX-License-Identifier: AGPL-3.0-only
// Compile with nvcc -x cu; execute only inside the managed GPU container.
// A listed device alone is insufficient: allocation, a kernel and readback must work.
#include <cuda_runtime.h>
#include <cstdio>

__global__ void verify_kernel(int* value) { *value = 42; }

static bool checked(cudaError_t status, const char* operation) {
    if (status == cudaSuccess) return true;
    std::fprintf(stderr, "%s failed: %s\n", operation, cudaGetErrorString(status));
    return false;
}

int main() {
    int count = 0;
    if (!checked(cudaGetDeviceCount(&count), "cudaGetDeviceCount")) return 1;
    if (count == 0) {
        std::fprintf(stderr, "No CUDA device is available in this container.\n");
        return 1;
    }
    cudaDeviceProp properties{};
    if (!checked(cudaGetDeviceProperties(&properties, 0), "cudaGetDeviceProperties")) return 1;
    int* device = nullptr;
    if (!checked(cudaMalloc(&device, sizeof(int)), "cudaMalloc")) return 1;
    verify_kernel<<<1, 1>>>(device);
    int observed = 0;
    const bool passed = checked(cudaGetLastError(), "kernel launch") &&
        checked(cudaDeviceSynchronize(), "cudaDeviceSynchronize") &&
        checked(cudaMemcpy(&observed, device, sizeof(int), cudaMemcpyDeviceToHost), "cudaMemcpy") &&
        observed == 42;
    const bool released = checked(cudaFree(device), "cudaFree");
    std::printf("GPU: %s; compute capability: %d.%d; kernel/readback: %s\n",
        properties.name, properties.major, properties.minor, passed && released ? "PASS" : "FAIL");
    return passed && released ? 0 : 1;
}
