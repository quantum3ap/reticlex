#!/usr/bin/env bash
# Builds the ReticleX core as a freestanding WebAssembly module.
#
# The front end renders the live preview from this module, so the browser and
# the Windows host share one geometry implementation instead of two that drift.
# Requires clang 15+ with the wasm32 target and wasm-ld (Ubuntu: clang lld).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/frontend/assets/reticlex_core.wasm}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

CLANG="${CLANG:-clang}"
CLANGXX="${CLANGXX:-clang++}"

COMMON=(
  --target=wasm32
  -O2 -DNDEBUG
  -fno-math-errno
  -ffunction-sections -fdata-sections
  -fvisibility=hidden
  -nostdlib
  -I"$ROOT/core/c/include"
  -I"$ROOT/core/cpp/include"
  -Wall -Wextra -Wno-unused-parameter
)

C_SOURCES=(rx_math.c rx_rand.c rx_color.c rx_hash.c rx_freestanding.c)
CXX_SOURCES=(config.cpp geometry.cpp raster.cpp random.cpp api.cpp)

OBJECTS=()
for src in "${C_SOURCES[@]}"; do
  "$CLANG" "${COMMON[@]}" -std=c11 -c "$ROOT/core/c/src/$src" -o "$WORK/${src%.c}.o"
  OBJECTS+=("$WORK/${src%.c}.o")
done
for src in "${CXX_SOURCES[@]}"; do
  "$CLANGXX" "${COMMON[@]}" -std=c++20 -fno-exceptions -fno-rtti \
    -c "$ROOT/core/cpp/src/$src" -o "$WORK/${src%.cpp}.o"
  OBJECTS+=("$WORK/${src%.cpp}.o")
done

mkdir -p "$(dirname "$OUT")"
wasm-ld \
  --no-entry \
  --export-dynamic \
  --gc-sections \
  --strip-all \
  --initial-memory=4194304 \
  --max-memory=16777216 \
  -z stack-size=131072 \
  "${OBJECTS[@]}" \
  -o "$OUT"

printf 'build-wasm: %s (%s bytes)\n' "$OUT" "$(wc -c < "$OUT")"
