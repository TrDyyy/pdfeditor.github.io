# PDF Studio — Image Overlay Editor

Ứng dụng Vue 3 chạy hoàn toàn trong trình duyệt để chèn PNG, JPEG hoặc WebP lên PDF mà không rasterize nội dung gốc.

## Chạy local

```bash
npm install
npm run dev
```

Kiểm tra và build production:

```bash
npm run typecheck
npm run build
```

Thư mục `dist/` dùng đường dẫn asset tương đối nên có thể deploy trực tiếp lên GitHub Pages.

## Cách dùng

1. Chọn một PDF.
2. Chọn trang ở thanh bên rồi bấm **Thêm ảnh**.
3. Kéo ảnh để di chuyển, kể cả kéo và thả sang một trang PDF khác; vùng tài liệu tự cuộn khi kéo sát mép.
4. Ở chế độ thường, kéo bốn góc hoặc nhập kích thước để resize; dùng tay nắm phía trên để xoay.
5. Double-click ảnh hoặc bấm **Cắt ảnh** để vào chế độ crop. Các tay nắm màu đen lúc này cắt từng cạnh/góc; double-click lần nữa hoặc bấm **Xong cắt ảnh** để trở về resize.
6. Bảng **Cắt xén** vẫn cho phép nhập chính xác; phần bị cắt cũng được loại khỏi ảnh nhúng khi xuất.
7. Nhấn `Delete`/`Backspace` hoặc **Xóa ảnh** để xóa ảnh đang chọn.
8. Bấm **Tải PDF** để xuất bản mới.

Tọa độ overlay được lưu theo viewport PDF ở scale 1, độc lập với zoom và device pixel ratio. Khi export, các điểm được đổi ngược về PDF user space bằng viewport transform của PDF.js, bao gồm rotation sẵn có của từng trang.

## Phase 3

- Vẽ, tải lên và lưu chữ ký trực quan trong IndexedDB (không phải chữ ký số mật mã).
- Hình chữ nhật, elip, đường thẳng và mũi tên được xuất dưới dạng vector PDF.
- Che trắng trực quan, con dấu preset và vùng tô sáng bán trong suốt.
- Che trắng không phải redaction an toàn: nội dung gốc bên dưới vẫn có thể tìm kiếm, trích xuất hoặc khôi phục.
