/*
 * rx_hash.h - FNV-1a hashing.
 *
 * Used to derive stable identifiers and to fingerprint a crosshair
 * configuration so the UI can tell "unchanged" from "dirty" without a deep
 * structural comparison on every keystroke.
 */
#ifndef RETICLEX_RX_HASH_H
#define RETICLEX_RX_HASH_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define RX_FNV1A64_OFFSET 0xCBF29CE484222325ULL
#define RX_FNV1A64_PRIME  0x00000100000001B3ULL

uint64_t rx_hash_bytes(const void *data, uint32_t length);
uint64_t rx_hash_update(uint64_t seed, const void *data, uint32_t length);
/* Convenience for NUL-terminated text; length is discovered internally. */
uint64_t rx_hash_string(const char *text);

#ifdef __cplusplus
}
#endif
#endif /* RETICLEX_RX_HASH_H */
