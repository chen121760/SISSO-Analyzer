# LIBSVM browser bundle

`libsvm.js` is the unmodified `dist/browser/asm/libsvm.js` from
[`libsvm-js@0.2.1`](https://github.com/mljs/libsvm), published at
https://registry.npmjs.org/libsvm-js/-/libsvm-js-0.2.1.tgz.

The release archive was verified against its npm SHA-512 integrity:
`tN9gh91NCAwSIhjgG3y8pdKETTwnwFvvSFNIrQQuJGVtAu0SO6Y43D7OEKMSVhQLQkgLADlDaqo9uxNGVEzJEA==`.

The BSD-3-Clause license is preserved in `libsvm.LICENSE`.
The self-contained asm.js bundle needs no WASM file, CDN, installation or build
step. It is imported inside the optional SVM worker only after user activation.
