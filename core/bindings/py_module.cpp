// pybind11 binding: exposes the native fractal core to Python as `mg_core`.
// render_frame returns a NumPy float32 array of smooth-escape values, shape
// (height, width). The compute runs with the GIL released so callers can
// render multiple frames concurrently with a thread pool.
#include <pybind11/pybind11.h>
#include <pybind11/numpy.h>

#include <stdexcept>

#include "mg/render.hpp"

namespace py = pybind11;

static py::array_t<float> render_frame(
    int fractal, int precision,
    double re_min, double re_max, double im_min, double im_max,
    int width, int height, int max_iter, double escape_r2,
    int degree, double julia_re, double julia_im) {

    if (width <= 0 || height <= 0)
        throw std::invalid_argument("width and height must be positive");

    py::array_t<float> result({height, width});
    float* out = static_cast<float*>(result.request().ptr);

    mg::Params p;
    p.degree = degree;
    p.julia_re = julia_re;
    p.julia_im = julia_im;

    const double re_range = re_max - re_min;
    const double im_range = im_max - im_min;

    {
        py::gil_scoped_release release;
        mg::render_band_dispatch(fractal, precision,
            re_min, re_range, im_max, im_range,
            width, height, /*y0=*/0, /*y1=*/height,
            max_iter, escape_r2, p, out);
    }
    return result;
}

PYBIND11_MODULE(mg_core, m) {
    m.doc() = "math_gallery native fractal rendering core";

    py::enum_<mg::Fractal>(m, "Fractal")
        .value("MANDELBROT", mg::F_MANDELBROT)
        .value("JULIA", mg::F_JULIA)
        .value("MULTIBROT", mg::F_MULTIBROT)
        .value("TRICORN", mg::F_TRICORN)
        .value("BURNING_SHIP", mg::F_BURNING_SHIP);

    py::enum_<mg::Precision>(m, "Precision")
        .value("F64", mg::P_F64)
        .value("DD", mg::P_DD)
        .value("QD", mg::P_QD);

    m.def("choose_precision", &mg::choose_precision, py::arg("re_width"),
          "Pick a precision tier (0=F64, 1=DD, 2=QD) from the view's real-axis width.");

    m.def("render_frame", &render_frame,
          py::arg("fractal"), py::arg("precision"),
          py::arg("re_min"), py::arg("re_max"),
          py::arg("im_min"), py::arg("im_max"),
          py::arg("width"), py::arg("height"),
          py::arg("max_iter"), py::arg("escape_r2") = 4.0,
          py::arg("degree") = 3, py::arg("julia_re") = 0.0, py::arg("julia_im") = 0.0,
          "Render one frame; returns float32 array (height, width) of smooth-escape values (-1 = in set).");
}
