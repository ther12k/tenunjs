# Hermes candidate slice 1 — builds against a prebuilt Hermes tree
# produced by acquire_hermes.sh (pinned tag v0.13.0, commit 4b3bf91).
#   cmake -B build -DHERMES_BUILD_DIR=/path/to/hermes-build
cmake_minimum_required(VERSION 3.20)
project(tenun_hermes_candidate C CXX)

set(HERMES_BUILD_DIR "" CACHE PATH "Prebuilt Hermes build tree (acquire_hermes.sh)")
if(NOT HERMES_BUILD_DIR)
  message(FATAL_ERROR "HERMES_BUILD_DIR must point at a built Hermes tree; run acquire_hermes.sh first")
endif()

add_library(tenun_hermes_adapter STATIC
  tenun_hermes_adapter.cpp
  sha256.c)
target_include_directories(tenun_hermes_adapter PUBLIC
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/..
  ${HERMES_BUILD_DIR}/../hermes-src/public
  ${HERMES_BUILD_DIR}/../hermes-src/API
  ${HERMES_BUILD_DIR}/../hermes-src/API/jsi
  ${HERMES_BUILD_DIR}/../hermes-src/external/llvh/include
  ${HERMES_BUILD_DIR}/generated)
target_compile_features(tenun_hermes_adapter PUBLIC cxx_std_17)
target_compile_options(tenun_hermes_adapter PRIVATE -fno-rtti -fvisibility=hidden)

# Link the shared libhermes produced by the pinned tree (target
# `libhermes`; builds API/hermes/libhermes.so). The shared object
# carries the full runtime and mirrors the binary's ICU link set.
add_library(hermes_runtime SHARED IMPORTED)
set_target_properties(hermes_runtime PROPERTIES
  IMPORTED_LOCATION ${HERMES_BUILD_DIR}/API/hermes/libhermes.so)

add_executable(abi_smoke abi_smoke.c)
add_library(jsi_runtime SHARED IMPORTED)
set_target_properties(jsi_runtime PROPERTIES
  IMPORTED_LOCATION ${HERMES_BUILD_DIR}/jsi/libjsi.so)
target_link_libraries(abi_smoke PRIVATE tenun_hermes_adapter hermes_runtime jsi_runtime dl pthread)
set(CMAKE_BUILD_RPATH ${HERMES_BUILD_DIR}/API/hermes)
