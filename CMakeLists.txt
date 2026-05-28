cmake_minimum_required(VERSION 3.18)
project(math_gallery_core CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# The double-double / quad-double kernels depend on strict IEEE-754 rounding.
# FP contraction (a*b+c -> fma) and fast-math BOTH break the error-free
# transforms (two_product etc). Never enable them for this core.
add_compile_options(-ffp-contract=off)
if(NOT MSVC)
  add_compile_options(-O3)
endif()

if(EMSCRIPTEN)
  # ---------------------------------------------------------------------------
  # WebAssembly target for the browser viewer. One module instance per worker;
  # no pthreads/SharedArrayBuffer (GitHub Pages can't set COOP/COEP headers).
  # ---------------------------------------------------------------------------
  add_executable(core core/src/wasm_api.cpp)
  target_include_directories(core PRIVATE core/include)
  set_target_properties(core PROPERTIES OUTPUT_NAME "core")
  target_link_options(core PRIVATE
    "-sMODULARIZE=1"
    "-sEXPORT_ES6=1"
    "-sENVIRONMENT=worker"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sFILESYSTEM=0"
    "-sEXPORTED_RUNTIME_METHODS=['HEAPF32','ccall']"
    "-sEXPORTED_FUNCTIONS=['_mg_render_band','_mg_choose_precision','_malloc','_free']"
  )
else()
  # ---------------------------------------------------------------------------
  # Native Python extension (pybind11), built via scikit-build-core.
  # ---------------------------------------------------------------------------
  find_package(pybind11 CONFIG REQUIRED)
  pybind11_add_module(mg_core core/bindings/py_module.cpp)
  target_include_directories(mg_core PRIVATE core/include)
  install(TARGETS mg_core LIBRARY DESTINATION .)
endif()
