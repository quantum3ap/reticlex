#include "test_harness.h"

int main() {
    rxtest::Registry &r = rxtest::Registry::instance();
    std::printf("ReticleX core: running %d test(s)\n", r.count);
    for (int i = 0; i < r.count; ++i) {
        r.current = r.names[i];
        r.fns[i]();
    }
    std::printf("%d check(s), %d failure(s)\n", r.checks, r.failures);
    if (r.failures == 0) {
        std::printf("PASS\n");
        return 0;
    }
    std::printf("FAIL\n");
    return 1;
}
