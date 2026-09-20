cmake_minimum_required(VERSION 3.22.1)
project("tenun_android")

add_definitions(-D_GNU_SOURCE -DCONFIG_VERSION="2024-01-13" -DCONFIG_BIGNUM)

# Test-only init-failure injection. Enabled ONLY when Gradle passes
# -Ptenun.testInjection=true (device acceptance stage: fail-visible tests).
# Production and standard debug builds compile without it — the injection
# hook does not exist in those binaries.
option(TENUN_ENABLE_TEST_INJECTION "Compile the test-only init-failure injection hook" OFF)
if(TENUN_ENABLE_TEST_INJECTION)
    add_definitions(-DTENUN_TEST_INJECTION)
endif()

add_library(tenun_android SHARED
    tenun_android_bridge.c
    quickjs/quickjs.c
    quickjs/cutils.c
    quickjs/libbf.c
    quickjs/libregexp.c
    quickjs/libunicode.c
)

target_include_directories(tenun_android PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/quickjs
)

target_compile_options(tenun_android PRIVATE
    -Wall -Wextra -Werror -Wno-sign-compare -Wno-unused-parameter
)

find_library(log-lib log)
find_library(android-lib android)

target_link_libraries(tenun_android
    ${log-lib}
    ${android-lib}
    m
)
