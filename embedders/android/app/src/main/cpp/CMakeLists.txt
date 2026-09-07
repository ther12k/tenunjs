cmake_minimum_required(VERSION 3.22.1)
project("tenun_android")

add_library(tenun_android SHARED
    tenun_android_bridge.c
)

find_library(log-lib log)
find_library(android-lib android)

target_link_libraries(tenun_android
    ${log-lib}
    ${android-lib}
)
