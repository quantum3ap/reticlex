#include "reticlex/rx_hash.h"

uint64_t rx_hash_update(uint64_t seed, const void *data, uint32_t length) {
    const unsigned char *bytes = (const unsigned char *)data;
    uint64_t hash = seed;
    if (!bytes) return hash;
    for (uint32_t i = 0; i < length; ++i) {
        hash ^= (uint64_t)bytes[i];
        hash *= RX_FNV1A64_PRIME;
    }
    return hash;
}

uint64_t rx_hash_bytes(const void *data, uint32_t length) {
    return rx_hash_update(RX_FNV1A64_OFFSET, data, length);
}

uint64_t rx_hash_string(const char *text) {
    if (!text) return RX_FNV1A64_OFFSET;
    uint32_t length = 0;
    while (text[length] != '\0') ++length;
    return rx_hash_bytes(text, length);
}
