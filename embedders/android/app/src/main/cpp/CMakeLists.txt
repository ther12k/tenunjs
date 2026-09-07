cmake_minimum_required(VERSION 3.22.1)
project("tenun_android")

add_definitions(-D_GNU_SOURCE -DCONFIG_VERSION="2024-01-13" -DCONFIG_BIGNUM)

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
