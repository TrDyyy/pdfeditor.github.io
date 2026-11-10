# Scanner Architecture

The scanner is a lazy-loaded feature at `#/scanner`. GitHub Pages remains compatible because navigation uses a hash route.

- `imageDecoder.ts`: MIME/size validation and browser image decoding. The original File is retained unchanged.
- `scanner.worker.js`: performs lightweight document segmentation and projective perspective warping off the UI thread without blocking on a WASM runtime.
- `scannerWorkerClient.ts`: typed request bridge, transferable pixel buffers, cleanup and timeout handling for the worker.
- `documentDetector.ts`: downsizes the source and sends transferable RGBA pixels to the worker for grayscale/Otsu document segmentation.
- `useCropSelection.ts`: deterministic ordering and quadrilateral validation.
- `perspectiveTransform.ts`: interactive perspective preview capped at 5 megapixels/2200px source edge. Original bytes remain untouched for a future full-resolution export path.
- `ScannerWorkspace.vue`: feature state and workflow.

No large pixel buffer, canvas or Blob is placed in serializable document state. Pixel buffers are transferred rather than copied between the UI and worker.
