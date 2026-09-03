/*
 * rx_freestanding.c - The four libc symbols a freestanding wasm build needs.
 *
 * Compiled only into the WebAssembly flavour of the core (see
 * scripts/build-wasm.sh). Clang lowers struct assignment and array clearing to
 * memcpy/memset calls, and there is no libc under --target=wasm32 -nostdlib to
 * resolve them against. Native builds link the platform's own versions.
 */
#if defined(__wasm__)

typedef unsigned long rx_size_t;

void *memcpy(void *dst, const void *src, rx_size_t n) {
    unsigned char *d = (unsigned char *)dst;
    const unsigned char *s = (const unsigned char *)src;
    for (rx_size_t i = 0; i < n; ++i) d[i] = s[i];
    return dst;
}

void *memset(void *dst, int value, rx_size_t n) {
    unsigned char *d = (unsigned char *)dst;
    const unsigned char v = (unsigned char)value;
    for (rx_size_t i = 0; i < n; ++i) d[i] = v;
    return dst;
}

void *memmove(void *dst, const void *src, rx_size_t n) {
    unsigned char *d = (unsigned char *)dst;
    const unsigned char *s = (const unsigned char *)src;
    if (d == s || n == 0) return dst;
    if (d < s) {
        for (rx_size_t i = 0; i < n; ++i) d[i] = s[i];
    } else {
        for (rx_size_t i = n; i > 0; --i) d[i - 1] = s[i - 1];
    }
    return dst;
}

int memcmp(const void *a, const void *b, rx_size_t n) {
    const unsigned char *x = (const unsigned char *)a;
    const unsigned char *y = (const unsigned char *)b;
    for (rx_size_t i = 0; i < n; ++i) {
        if (x[i] != y[i]) return (int)x[i] - (int)y[i];
    }
    return 0;
}

#endif /* __wasm__ */
