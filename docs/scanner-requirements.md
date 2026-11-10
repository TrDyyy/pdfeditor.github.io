# Document Scanner — Requirements

Sprint 7.1–7.2 accepts one JPEG, PNG or WebP image (maximum 35 MB), preserves the original Blob, detects a likely document quadrilateral, allows four-corner manual correction, and renders a perspective-corrected preview locally.

Auto detection is advisory. Low-confidence or failed detection falls back to a 5% inset manual crop. The scanner does not perform OCR, enhancement filters, camera capture, multi-page handling or export in these sprints.

The corner coordinates are always stored in original-image pixels. Invalid, self-intersecting or tiny quadrilaterals are rejected while dragging.
