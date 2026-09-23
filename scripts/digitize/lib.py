import math
import fitz  # PyMuPDF
import numpy as np
from PIL import Image
import io


def render_page(pdf_path, page_index, dpi=300):
    """Рендерит страницу PDF в PIL.Image при заданном dpi."""
    doc = fitz.open(pdf_path)
    page = doc[page_index]
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    doc.close()
    return img


def fit_log_axis(pixel_coords, values):
    """Калибровка лог-оси: pixel = slope*log10(value) + intercept.
    Возвращает {"slope": ..., "intercept": ...} через линейную регрессию."""
    logs = np.log10(np.array(values, dtype=float))
    px = np.array(pixel_coords, dtype=float)
    slope, intercept = np.polyfit(logs, px, 1)
    return {"slope": float(slope), "intercept": float(intercept)}


def value_at_pixel(pixel, cal):
    """Обратное преобразование: пиксель -> инженерная величина."""
    return 10 ** ((pixel - cal["intercept"]) / cal["slope"])


def fit_quadratic(xs, ys):
    """P = a*x^2 + b*x + c по точкам, снятым с кривой."""
    a, b, c = np.polyfit(np.array(xs, dtype=float), np.array(ys, dtype=float), 2)
    return {"a": float(a), "b": float(b), "c": float(c)}


def eval_quadratic(coeffs, x):
    return coeffs["a"] * x * x + coeffs["b"] * x + coeffs["c"]
