/* A deliberately tiny assertion harness: the core has no dependencies and the
   test binary should not introduce one either. */
#ifndef RETICLEX_TEST_HARNESS_H
#define RETICLEX_TEST_HARNESS_H

#include <cstdio>
#include <cstdlib>
#include <cmath>

namespace rxtest {

struct Registry {
    using Fn = void (*)();
    static constexpr int kMax = 256;
    Fn fns[kMax];
    const char *names[kMax];
    int count = 0;
    int failures = 0;
    int checks = 0;
    const char *current = "";

    static Registry &instance() {
        static Registry r;
        return r;
    }
};

struct Registrar {
    Registrar(const char *name, Registry::Fn fn) {
        Registry &r = Registry::instance();
        if (r.count < Registry::kMax) {
            r.names[r.count] = name;
            r.fns[r.count] = fn;
            ++r.count;
        }
    }
};

inline void report(bool ok, const char *expr, const char *file, int line) {
    Registry &r = Registry::instance();
    ++r.checks;
    if (!ok) {
        ++r.failures;
        std::printf("  FAIL %s\n       %s:%d\n       %s\n", r.current, file, line, expr);
    }
}

inline bool nearly(double a, double b, double tolerance) {
    double d = a - b;
    if (d < 0) d = -d;
    return d <= tolerance;
}

} // namespace rxtest

#define RX_TEST(name)                                                        \
    static void name();                                                      \
    static rxtest::Registrar rx_registrar_##name(#name, name);               \
    static void name()

#define CHECK(expr) rxtest::report((expr) ? true : false, #expr, __FILE__, __LINE__)
#define CHECK_NEAR(a, b, tol)                                                \
    rxtest::report(rxtest::nearly((double)(a), (double)(b), (double)(tol)),   \
                   #a " ~= " #b, __FILE__, __LINE__)

#endif /* RETICLEX_TEST_HARNESS_H */
