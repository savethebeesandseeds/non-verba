cmake_minimum_required(VERSION 3.22.1)
project(nonverba_audio LANGUAGES CXX)

add_library(nonverba_audio SHARED native_audio_device.cpp)
target_compile_features(nonverba_audio PRIVATE cxx_std_17)
target_compile_options(nonverba_audio PRIVATE -Wall -Wextra -Werror -fvisibility=hidden)
target_link_options(nonverba_audio PRIVATE -Wl,-z,max-page-size=16384)
target_link_libraries(nonverba_audio PRIVATE aaudio android dl)
