import math
from lib import fit_log_axis, value_at_pixel, fit_quadratic, eval_quadratic

def test_fit_log_axis_recovers_known_calibration():
    # pixel = slope*log10(value) + intercept, known slope=-200, intercept=800
    slope, intercept = -200.0, 800.0
    values = [10, 100, 1000, 10000]
    pixels = [slope * math.log10(v) + intercept for v in values]
    cal = fit_log_axis(pixels, values)
    assert abs(cal["slope"] - slope) < 0.5, cal
    assert abs(cal["intercept"] - intercept) < 0.5, cal
    # round-trip: value_at_pixel should recover original values within 1%
    for px, v in zip(pixels, values):
        got = value_at_pixel(px, cal)
        assert abs(got - v) / v < 0.01, (got, v)

def test_fit_quadratic_recovers_known_coeffs():
    a, b, c = -0.5, 10.0, 200.0
    xs = [1, 2, 3, 4, 5]
    ys = [a * x * x + b * x + c for x in xs]
    coeffs = fit_quadratic(xs, ys)
    assert abs(coeffs["a"] - a) < 0.01
    assert abs(coeffs["b"] - b) < 0.01
    assert abs(coeffs["c"] - c) < 0.5
    assert abs(eval_quadratic(coeffs, 3) - ys[2]) < 0.5

if __name__ == "__main__":
    tests = [v for k, v in list(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
    raise SystemExit(1 if failed else 0)
