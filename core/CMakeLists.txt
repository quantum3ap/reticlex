cmake_minimum_required(VERSION 3.20)
project(reticlex_core LANGUAGES C CXX VERSION 1.0.0)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

option(RETICLEX_BUILD_TESTS "Build the native core test suite" ON)
option(RETICLEX_BUILD_SHARED "Build the shared library consumed by the desktop host" ON)

set(RETICLEX_SOURCES
    c/src/rx_math.c
    c/src/rx_rand.c
    c/src/rx_color.c
    c/src/rx_hash.c
    cpp/src/config.cpp
    cpp/src/geometry.cpp
    cpp/src/raster.cpp
    cpp/src/random.cpp
    cpp/src/api.cpp
)

set(RETICLEX_INCLUDES
    ${CMAKE_CURRENT_SOURCE_DIR}/c/include
    ${CMAKE_CURRENT_SOURCE_DIR}/cpp/include
)

# Static flavour: linked into the test binary and available to any embedder.
add_library(reticlex_core_static STATIC ${RETICLEX_SOURCES})
target_include_directories(reticlex_core_static PUBLIC ${RETICLEX_INCLUDES})

if(MSVC)
    target_compile_options(reticlex_core_static PRIVATE /W4 /fp:precise)
else()
    target_compile_options(reticlex_core_static PRIVATE
        -Wall -Wextra -Wno-unused-parameter -fno-math-errno)
endif()

if(RETICLEX_BUILD_SHARED)
    # Shared flavour: this is reticlex_core.dll, loaded by the C# host.
    add_library(reticlex_core SHARED ${RETICLEX_SOURCES})
    target_include_directories(reticlex_core PUBLIC ${RETICLEX_INCLUDES})
    target_compile_definitions(reticlex_core PRIVATE RETICLEX_BUILD_SHARED=1)
    set_target_properties(reticlex_core PROPERTIES
        OUTPUT_NAME "reticlex_core"
        C_VISIBILITY_PRESET hidden
        CXX_VISIBILITY_PRESET hidden
        VERSION ${PROJECT_VERSION})
    if(MSVC)
        target_compile_options(reticlex_core PRIVATE /W4 /fp:precise)
    else()
        target_compile_options(reticlex_core PRIVATE
            -Wall -Wextra -Wno-unused-parameter -fno-math-errno)
    endif()
endif()

if(RETICLEX_BUILD_TESTS)
    enable_testing()
    add_executable(reticlex_tests
        tests/test_main.cpp
        tests/test_math.cpp
        tests/test_color.cpp
        tests/test_rand.cpp
        tests/test_config.cpp
        tests/test_geometry.cpp
        tests/test_raster.cpp
        tests/test_random.cpp
    )
    target_link_libraries(reticlex_tests PRIVATE reticlex_core_static)
    target_include_directories(reticlex_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    add_test(NAME reticlex_core_tests COMMAND reticlex_tests)

    # Emits the golden geometry fixtures the JavaScript conformance test reads,
    # proving the wasm build and the native build agree.
    add_executable(reticlex_fixtures tests/fixture_writer.cpp)
    target_link_libraries(reticlex_fixtures PRIVATE reticlex_core_static)
    target_include_directories(reticlex_fixtures PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
endif()
