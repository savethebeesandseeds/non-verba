// SPDX-License-Identifier: AGPL-3.0-only
#include <aaudio/AAudio.h>
#include <android/api-level.h>
#include <jni.h>
#include <dlfcn.h>
#include <time.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <memory>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

namespace {
constexpr int kRate = 48000;
constexpr int kChunk = 96000;
constexpr int kMaxFrames = 30 * kRate;
constexpr int kProbeFrames = 36864;
constexpr int kMaxRounds = 15;
constexpr int64_t kCallbackGapNs = 250000000;
static_assert(std::atomic<int64_t>::is_always_lock_free);
static_assert(std::atomic<int>::is_always_lock_free);

int64_t monotonicNs() {
    timespec time{};
    if (clock_gettime(CLOCK_MONOTONIC, &time) != 0) return 0;
    return int64_t(time.tv_sec) * 1000000000 + time.tv_nsec;
}

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

void checked(aaudio_result_t result, const char* operation) {
    if (result < 0) throw std::runtime_error(std::string(operation) + ": " + AAudio_convertResultToText(result));
}

// The APK still supports API26. Optional API28/30 symbols must never become
// load-time dependencies, even though strict microphone capture requires API29.
struct Attributes {
    using SetPreset = void (*)(AAudioStreamBuilder*, aaudio_input_preset_t);
    using GetPreset = aaudio_input_preset_t (*)(AAudioStream*);
    using SetUsage = void (*)(AAudioStreamBuilder*, aaudio_usage_t);
    using SetSession = void (*)(AAudioStreamBuilder*, aaudio_session_id_t);
    using GetSession = aaudio_session_id_t (*)(AAudioStream*);
    using SetPrivacy = void (*)(AAudioStreamBuilder*, bool);
    using GetPrivacy = bool (*)(AAudioStream*);
    SetPreset setPreset = reinterpret_cast<SetPreset>(dlsym(RTLD_DEFAULT, "AAudioStreamBuilder_setInputPreset"));
    GetPreset getPreset = reinterpret_cast<GetPreset>(dlsym(RTLD_DEFAULT, "AAudioStream_getInputPreset"));
    SetUsage setUsage = reinterpret_cast<SetUsage>(dlsym(RTLD_DEFAULT, "AAudioStreamBuilder_setUsage"));
    SetSession setSession = reinterpret_cast<SetSession>(dlsym(RTLD_DEFAULT, "AAudioStreamBuilder_setSessionId"));
    GetSession getSession = reinterpret_cast<GetSession>(dlsym(RTLD_DEFAULT, "AAudioStream_getSessionId"));
    SetPrivacy setPrivacy = reinterpret_cast<SetPrivacy>(dlsym(RTLD_DEFAULT, "AAudioStreamBuilder_setPrivacySensitive"));
    GetPrivacy getPrivacy = reinterpret_cast<GetPrivacy>(dlsym(RTLD_DEFAULT, "AAudioStream_isPrivacySensitive"));
};

struct Probe {
    std::array<float, kProbeFrames> samples{};
    // Publication: control thread writes samples before queuedCount release;
    // callback writes start/end details before their corresponding release flag.
    int64_t startFrame = 0;
    int64_t endFrame = 0;
    int64_t firstCallbackNs = 0;
    int inputFrame = 0;
    std::atomic<bool> started{false};
    std::atomic<bool> done{false};
};

struct Checkpoint {
    int64_t observedNs;
    int64_t inputFrame;
    int64_t inputTime;
    int64_t outputFrame;
    int64_t outputTime;
    int captured;
};

struct Device {
    Attributes attributes;
    AAudioStream* input = nullptr;
    AAudioStream* output = nullptr;
    const int inputId;
    const int outputId;
    const int inputSessionId;
    const bool privacySupported = android_get_device_api_level() >= 30;
    std::array<float, kMaxFrames> pcm{};
    std::array<Probe, kMaxRounds> probes{};
    std::atomic<int> fatal{0};
    std::atomic<int> captured{0};
    std::atomic<int> target{0};
    std::atomic<int> queuedCount{0};
    std::atomic<int64_t> inputFrames{0};
    std::atomic<int64_t> outputFrames{0};
    std::atomic<int64_t> recordStartFrame{-1};
    std::atomic<int64_t> firstCallbackNs{0};
    std::atomic<int64_t> lastCallbackNs{0};
    int64_t previousInputCallbackNs = 0; // input callback thread only
    int64_t previousOutputCallbackNs = 0; // output callback thread only
    int outputRound = 0;                 // output callback thread only
    int outputProbeOffset = 0;
    int64_t recordRequestedNs = 0;       // control thread only
    bool timestampsReady = false;
    bool recordingWasStarted = false;
    int inputXruns = 0;
    int outputXruns = 0;
    std::vector<Checkpoint> checkpoints;

    Device(int requestedInput, int requestedOutput, int requestedSession)
        : inputId(requestedInput), outputId(requestedOutput), inputSessionId(requestedSession) {
        require(android_get_device_api_level() >= 29, "Native audio requires Android API29 or newer");
        require(inputId > 0 && outputId > 0 && inputSessionId > 0, "Explicit built-in audio routes and an allocated input session are required");
        require(attributes.setPreset && attributes.getPreset && attributes.setUsage && attributes.setSession && attributes.getSession,
            "AAudio unprocessed/session attributes are unavailable");
        require(!privacySupported || (attributes.setPrivacy && attributes.getPrivacy), "AAudio privacy-sensitive attributes are unavailable");
        checkpoints.reserve(512);
    }

    ~Device() { close(); }

    void close() noexcept {
        // Never called on an AAudio callback. close waits for its callback to exit.
        if (input) { AAudioStream_requestStop(input); AAudioStream_close(input); input = nullptr; }
        if (output) { AAudioStream_requestStop(output); AAudioStream_close(output); output = nullptr; }
    }

    static void onError(AAudioStream*, void* context, aaudio_result_t error) {
        static_cast<Device*>(context)->fatal.store(error ? error : -1, std::memory_order_release);
    }

    static aaudio_data_callback_result_t onInput(AAudioStream*, void* context, void* audio, int32_t count) {
        auto& self = *static_cast<Device*>(context);
        if (self.fatal.load(std::memory_order_acquire)) return AAUDIO_CALLBACK_RESULT_STOP;
        if (!audio || count <= 0 || count > kRate) { self.fatal.store(-10001); return AAUDIO_CALLBACK_RESULT_STOP; }
        const int64_t now = monotonicNs();
        const int wanted = self.target.load(std::memory_order_acquire);
        const int oldCount = self.captured.load(std::memory_order_relaxed);
        if (wanted && oldCount < wanted) {
            if (now <= 0 || (oldCount && (now < self.previousInputCallbackNs || now - self.previousInputCallbackNs > kCallbackGapNs))) {
                self.fatal.store(-10002); return AAUDIO_CALLBACK_RESULT_STOP;
            }
            if (!oldCount) {
                self.recordStartFrame.store(self.inputFrames.load(std::memory_order_relaxed), std::memory_order_relaxed);
                self.firstCallbackNs.store(now, std::memory_order_release);
            }
            const int take = std::min(count, wanted - oldCount);
            std::memcpy(self.pcm.data() + oldCount, audio, size_t(take) * sizeof(float));
            self.lastCallbackNs.store(now, std::memory_order_relaxed);
            self.captured.store(oldCount + take, std::memory_order_release);
        }
        self.previousInputCallbackNs = now;
        self.inputFrames.fetch_add(count, std::memory_order_release);
        return AAUDIO_CALLBACK_RESULT_CONTINUE;
    }

    static aaudio_data_callback_result_t onOutput(AAudioStream*, void* context, void* audio, int32_t count) {
        auto& self = *static_cast<Device*>(context);
        if (self.fatal.load(std::memory_order_acquire)) return AAUDIO_CALLBACK_RESULT_STOP;
        if (!audio || count <= 0 || count > kRate) { self.fatal.store(-10003); return AAUDIO_CALLBACK_RESULT_STOP; }
        auto* buffer = static_cast<float*>(audio);
        std::fill_n(buffer, count, 0.0f); // Speaker silence only; input is never padded or mixed.
        const int64_t now = monotonicNs();
        if (self.target.load(std::memory_order_acquire) && self.previousOutputCallbackNs &&
            (now <= 0 || now < self.previousOutputCallbackNs || now - self.previousOutputCallbackNs > kCallbackGapNs)) {
            self.fatal.store(-10004); return AAUDIO_CALLBACK_RESULT_STOP;
        }
        self.previousOutputCallbackNs = now;
        const int64_t frame = self.outputFrames.load(std::memory_order_relaxed);
        if (self.firstCallbackNs.load(std::memory_order_acquire) && self.outputRound < self.queuedCount.load(std::memory_order_acquire)) {
            auto& probe = self.probes[size_t(self.outputRound)];
            if (!self.outputProbeOffset) {
                probe.startFrame = frame;
                probe.firstCallbackNs = now;
                probe.inputFrame = self.captured.load(std::memory_order_acquire);
                probe.started.store(true, std::memory_order_release);
            }
            const int take = std::min(count, kProbeFrames - self.outputProbeOffset);
            std::memcpy(buffer, probe.samples.data() + self.outputProbeOffset, size_t(take) * sizeof(float));
            self.outputProbeOffset += take;
            if (self.outputProbeOffset == kProbeFrames) {
                probe.endFrame = frame + take;
                probe.done.store(true, std::memory_order_release);
                self.outputRound++;
                self.outputProbeOffset = 0;
            }
        }
        self.outputFrames.fetch_add(count, std::memory_order_release);
        return AAUDIO_CALLBACK_RESULT_CONTINUE;
    }

    AAudioStream* openStream(bool isInput) {
        AAudioStreamBuilder* builder = nullptr;
        checked(AAudio_createStreamBuilder(&builder), "Create AAudio stream builder");
        struct Cleanup { AAudioStreamBuilder* builder; ~Cleanup() { AAudioStreamBuilder_delete(builder); } } cleanup{builder};
        AAudioStreamBuilder_setDirection(builder, isInput ? AAUDIO_DIRECTION_INPUT : AAUDIO_DIRECTION_OUTPUT);
        AAudioStreamBuilder_setDeviceId(builder, isInput ? inputId : outputId);
        AAudioStreamBuilder_setSampleRate(builder, kRate);
        AAudioStreamBuilder_setChannelCount(builder, 1);
        AAudioStreamBuilder_setFormat(builder, AAUDIO_FORMAT_PCM_FLOAT);
        // Android 11's legacy LOW_LATENCY input can open a PCM16 AudioRecord and
        // convert it to FLOAT callbacks. NONE keeps the requested input FLOAT at
        // both observed client boundaries; all format/timing checks still apply.
        AAudioStreamBuilder_setPerformanceMode(builder,
            isInput ? AAUDIO_PERFORMANCE_MODE_NONE : AAUDIO_PERFORMANCE_MODE_LOW_LATENCY);
        // Shared mode is explicit and reported. Exclusive ownership is not claimed.
        AAudioStreamBuilder_setSharingMode(builder, AAUDIO_SHARING_MODE_SHARED);
        if (isInput) {
            attributes.setPreset(builder, AAUDIO_INPUT_PRESET_UNPROCESSED);
            attributes.setSession(builder, inputSessionId);
            if (privacySupported) attributes.setPrivacy(builder, true);
        }
        else attributes.setUsage(builder, AAUDIO_USAGE_MEDIA);
        AAudioStreamBuilder_setDataCallback(builder, isInput ? onInput : onOutput, this);
        AAudioStreamBuilder_setErrorCallback(builder, onError, this);
        AAudioStream* stream = nullptr;
        checked(AAudioStreamBuilder_openStream(builder, &stream), "Open AAudio stream");
        return stream;
    }

    void open() {
        input = openStream(true);
        output = openStream(false);
        checkConfiguration(input, inputId);
        checkConfiguration(output, outputId);
        require(attributes.getPreset(input) == AAUDIO_INPUT_PRESET_UNPROCESSED, "AAudio did not select unprocessed input");
        checkInputIdentity();
        // A small bounded output queue is needed for successive <800ms probes.
        checked(AAudioStream_setBufferSizeInFrames(output, AAudioStream_getFramesPerBurst(output) * 2), "Set AAudio output buffer");
        checked(AAudioStream_requestStart(output), "Start AAudio speaker");
        checked(AAudioStream_requestStart(input), "Start AAudio microphone");
    }

    void checkConfiguration(AAudioStream* stream, int expectedId) {
        require(AAudioStream_getDeviceId(stream) == expectedId, "AAudio route differs from the selected built-in device");
        require(AAudioStream_getSampleRate(stream) == kRate && AAudioStream_getChannelCount(stream) == 1 &&
            AAudioStream_getFormat(stream) == AAUDIO_FORMAT_PCM_FLOAT, "AAudio cannot provide 48kHz mono float audio");
        require(AAudioStream_getFramesPerBurst(stream) > 0 && AAudioStream_getFramesPerBurst(stream) <= kRate &&
            AAudioStream_getBufferCapacityInFrames(stream) >= AAudioStream_getFramesPerBurst(stream) && AAudioStream_getBufferCapacityInFrames(stream) <= kRate,
            "AAudio buffer configuration exceeds the strict profile");
    }

    void checkHealth() {
        const auto error = fatal.load(std::memory_order_acquire);
        if (error) throw std::runtime_error("AAudio capture failed or a callback was interrupted (" + std::to_string(error) + ")");
        require(input && output, "AAudio session is closed");
        checkConfiguration(input, inputId);
        checkConfiguration(output, outputId);
        require(attributes.getPreset(input) == AAUDIO_INPUT_PRESET_UNPROCESSED, "AAudio input preset changed");
        checkInputIdentity();
        inputXruns = AAudioStream_getXRunCount(input);
        outputXruns = AAudioStream_getXRunCount(output);
        // Some HALs report zero even when input xrun reporting is incomplete.
        // Preserve that limitation in the evidence; never reinterpret negatives.
        require(inputXruns == 0 && outputXruns == 0, "AAudio reported a dropped/underrun buffer or unsupported xrun counter");
        const auto inState = AAudioStream_getState(input);
        const auto outState = AAudioStream_getState(output);
        require((inState == AAUDIO_STREAM_STATE_STARTING || inState == AAUDIO_STREAM_STATE_STARTED) &&
            (outState == AAUDIO_STREAM_STATE_STARTING || outState == AAUDIO_STREAM_STATE_STARTED), "AAudio stream stopped or disconnected");
    }

    void checkInputIdentity() {
        require(attributes.getSession(input) == inputSessionId, "AAudio input session differs from its allocated recording identity");
        require(!privacySupported || attributes.getPrivacy(input), "AAudio input is not privacy sensitive");
    }

    void pollTimestamps() {
        int64_t inFrame = 0, inTime = 0, outFrame = 0, outTime = 0;
        const auto inResult = AAudioStream_getTimestamp(input, CLOCK_MONOTONIC, &inFrame, &inTime);
        const auto outResult = AAudioStream_getTimestamp(output, CLOCK_MONOTONIC, &outFrame, &outTime);
        if (inResult != AAUDIO_OK || outResult != AAUDIO_OK) {
            require(!timestampsReady, "AAudio hardware timestamps became unavailable");
            return; // Bounded startup waits in Kotlin; no fabricated checkpoint.
        }
        const auto now = monotonicNs();
        require(inFrame >= 0 && outFrame >= 0 && inTime > 0 && outTime > 0 && inTime <= now && outTime <= now &&
            now - inTime <= 1000000000 && now - outTime <= 1000000000, "AAudio timestamps are stale or outside the monotonic timebase");
        timestampsReady = true;
        if (!recordingWasStarted) return;
        if (!checkpoints.empty()) {
            const auto& last = checkpoints.back();
            require(inFrame >= last.inputFrame && inTime >= last.inputTime && outFrame >= last.outputFrame && outTime >= last.outputTime,
                "AAudio hardware timestamp regressed");
            if (now - last.observedNs < 100000000 || inFrame == last.inputFrame || inTime == last.inputTime ||
                outFrame == last.outputFrame || outTime == last.outputTime) return;
        }
        require(checkpoints.size() < 512, "AAudio timestamp evidence exceeded its bound");
        checkpoints.push_back({now, inFrame, inTime, outFrame, outTime, captured.load(std::memory_order_acquire)});
    }

    void record(int frames) {
        checkHealth();
        pollTimestamps();
        require(timestampsReady && !recordingWasStarted && frames > 0 && frames <= kMaxFrames && frames % kChunk == 0,
            "AAudio is not ready for a new bounded recording");
        recordRequestedNs = monotonicNs();
        recordingWasStarted = true;
        target.store(frames, std::memory_order_release);
    }

    void play(int index, const float* samples, int count) {
        checkHealth();
        require(recordingWasStarted && index >= 0 && index < kMaxRounds && index < target.load(std::memory_order_acquire) / kChunk &&
            index == queuedCount.load(std::memory_order_acquire) && count == kProbeFrames,
            "Unexpected native acoustic probe sequence or size");
        require(index == 0 || probes[size_t(index - 1)].done.load(std::memory_order_acquire), "Previous acoustic probe has not finished");
        std::copy_n(samples, count, probes[size_t(index)].samples.begin());
        queuedCount.store(index + 1, std::memory_order_release);
    }

    static const char* sharing(AAudioStream* stream) {
        return AAudioStream_getSharingMode(stream) == AAUDIO_SHARING_MODE_EXCLUSIVE ? "exclusive" : "shared";
    }
    static const char* performance(AAudioStream* stream) {
        switch (AAudioStream_getPerformanceMode(stream)) {
            case AAUDIO_PERFORMANCE_MODE_LOW_LATENCY: return "low-latency";
            case AAUDIO_PERFORMANCE_MODE_POWER_SAVING: return "power-saving";
            default: return "none";
        }
    }
    static void streamJson(std::ostream& out, AAudioStream* stream, const char* type) {
        require(AAudioStream_getFormat(stream) == AAUDIO_FORMAT_PCM_FLOAT,
            "AAudio stream format changed before its metadata snapshot");
        out << "{\"device_id\":" << AAudioStream_getDeviceId(stream) << ",\"device_type\":\"" << type
            << "\",\"sample_rate\":" << AAudioStream_getSampleRate(stream) << ",\"channels\":" << AAudioStream_getChannelCount(stream)
            << ",\"format\":\"pcm-f32\",\"sharing_mode\":\"" << sharing(stream)
            << "\",\"performance_mode\":\"" << performance(stream) << "\",\"frames_per_burst\":" << AAudioStream_getFramesPerBurst(stream)
            << ",\"buffer_capacity_frames\":" << AAudioStream_getBufferCapacityInFrames(stream) << "}";
    }

    std::string snapshot() {
        checkHealth();
        pollTimestamps();
        const auto frameCount = captured.load(std::memory_order_acquire);
        const bool complete = recordingWasStarted && frameCount == target.load(std::memory_order_acquire);
        std::ostringstream out;
        out << "{\"timestamps_ready\":" << (timestampsReady ? "true" : "false") << ",\"captured_frames\":" << frameCount
            << ",\"input_session_id\":" << attributes.getSession(input)
            << ",\"privacy_sensitive_supported\":" << (privacySupported ? "true" : "false")
            << ",\"privacy_sensitive_requested\":" << (privacySupported ? "true" : "false")
            << ",\"privacy_sensitive_actual\":" << (privacySupported ? (attributes.getPrivacy(input) ? "true" : "false") : "null")
            << ",\"record_requested_monotonic_ns\":\"" << recordRequestedNs << "\",\"record_start_stream_frame\":\"" << recordStartFrame.load()
            << "\",\"first_input_callback_monotonic_ns\":\"" << firstCallbackNs.load(std::memory_order_acquire)
            << "\",\"last_input_callback_monotonic_ns\":\"" << lastCallbackNs.load() << "\",\"input_xruns\":" << inputXruns
            << ",\"output_xruns\":" << outputXruns << ",\"input\":";
        streamJson(out, input, "built-in-mic");
        out << ",\"output\":";
        streamJson(out, output, "built-in-speaker");
        out << ",\"checkpoints\":[";
        // Polling runs frequently for challenge delivery. Only serialize the
        // growing evidence arrays at completion; they remain retained natively.
        for (size_t index = 0; complete && index < checkpoints.size(); ++index) {
            if (index) out << ',';
            const auto& item = checkpoints[index];
            out << "{\"observed_monotonic_ns\":\"" << item.observedNs << "\",\"input_frame_position\":\"" << item.inputFrame
                << "\",\"input_timestamp_ns\":\"" << item.inputTime << "\",\"output_frame_position\":\"" << item.outputFrame
                << "\",\"output_timestamp_ns\":\"" << item.outputTime << "\",\"captured_frames\":" << item.captured
                << ",\"input_xruns\":0,\"output_xruns\":0}";
        }
        out << "],\"rounds\":[";
        bool separator = false;
        for (int index = 0; complete && index < queuedCount.load(std::memory_order_acquire); ++index) {
            const auto& probe = probes[size_t(index)];
            if (!probe.done.load(std::memory_order_acquire)) break;
            if (separator) out << ',';
            separator = true;
            out << "{\"index\":" << index << ",\"output_start_stream_frame\":\"" << probe.startFrame
                << "\",\"output_end_stream_frame\":\"" << probe.endFrame << "\",\"output_first_callback_monotonic_ns\":\"" << probe.firstCallbackNs
                << "\",\"input_frame_at_output_start\":" << probe.inputFrame << "}";
        }
        out << "]}";
        return out.str();
    }
};

std::mutex devicesMutex;
std::unordered_map<jlong, std::unique_ptr<Device>> devices;
jlong nextHandle = 1;

Device& get(jlong handle) {
    auto found = devices.find(handle);
    require(found != devices.end(), "Unknown or closed AAudio session");
    return *found->second;
}

void exception(JNIEnv* env, const std::exception& error) {
    auto type = env->FindClass("java/lang/IllegalStateException");
    if (type) env->ThrowNew(type, error.what());
}
} // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_org_nonverba_camera_NativeAudioDevice_open(JNIEnv* env, jobject, jint input, jint output, jint inputSession) {
    try {
        std::lock_guard<std::mutex> guard(devicesMutex);
        require(devices.empty(), "An AAudio session is already active");
        auto device = std::make_unique<Device>(input, output, inputSession);
        device->open();
        const jlong handle = nextHandle++;
        devices.emplace(handle, std::move(device));
        return handle;
    } catch (const std::exception& error) { exception(env, error); return 0; }
}

extern "C" JNIEXPORT jstring JNICALL
Java_org_nonverba_camera_NativeAudioDevice_snapshot(JNIEnv* env, jobject, jlong handle) {
    try {
        std::lock_guard<std::mutex> guard(devicesMutex);
        const auto json = get(handle).snapshot();
        return env->NewStringUTF(json.c_str());
    } catch (const std::exception& error) { exception(env, error); return nullptr; }
}

extern "C" JNIEXPORT void JNICALL
Java_org_nonverba_camera_NativeAudioDevice_record(JNIEnv* env, jobject, jlong handle, jint frames) {
    try { std::lock_guard<std::mutex> guard(devicesMutex); get(handle).record(frames); }
    catch (const std::exception& error) { exception(env, error); }
}

extern "C" JNIEXPORT void JNICALL
Java_org_nonverba_camera_NativeAudioDevice_play(JNIEnv* env, jobject, jlong handle, jint index, jfloatArray samples) {
    try {
        require(samples && env->GetArrayLength(samples) == kProbeFrames, "Invalid native probe length");
        std::array<float, kProbeFrames> copy{};
        env->GetFloatArrayRegion(samples, 0, kProbeFrames, copy.data());
        if (env->ExceptionCheck()) return;
        std::lock_guard<std::mutex> guard(devicesMutex);
        get(handle).play(index, copy.data(), kProbeFrames);
    } catch (const std::exception& error) { exception(env, error); }
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_org_nonverba_camera_NativeAudioDevice_copyFrames(JNIEnv* env, jobject, jlong handle, jint first, jint count) {
    try {
        std::lock_guard<std::mutex> guard(devicesMutex);
        auto& device = get(handle);
        device.checkHealth();
        require(first >= 0 && count > 0 && count <= kMaxFrames && first <= kMaxFrames - count &&
            first + count <= device.captured.load(std::memory_order_acquire), "Requested native microphone samples are not available");
        auto result = env->NewFloatArray(count);
        if (result) env->SetFloatArrayRegion(result, 0, count, device.pcm.data() + first);
        return result;
    } catch (const std::exception& error) { exception(env, error); return nullptr; }
}

extern "C" JNIEXPORT void JNICALL
Java_org_nonverba_camera_NativeAudioDevice_close(JNIEnv* env, jobject, jlong handle) {
    try { std::lock_guard<std::mutex> guard(devicesMutex); devices.erase(handle); }
    catch (const std::exception& error) { exception(env, error); }
}
