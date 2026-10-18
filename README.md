# FactoryOne — Quản lý sản xuất & xưởng gia công (MES-lite)

Ứng dụng điều hành xưởng sản xuất nhỏ / xưởng gia công cơ khí, xây dựng theo tài liệu đặc tả `docs/PRD.md`: React 19 + Vite + TypeScript, Ant Design 6, SCSS Modules và Dexie (lưu trữ cục bộ trên trình duyệt — không cần máy chủ).

- **Website:** khoadev.vn
- **Email liên hệ:** khoadev.company@gmail.com
- **Bối cảnh dữ liệu mẫu:** Xưởng Cơ khí KhoaDev (thép hộp, inox, sơn tĩnh điện, xe đẩy, kệ sắt, tủ điện).

## Chạy dự án

```bash
npm install
npm run dev       # chạy môi trường phát triển
npm run build     # kiểm tra TypeScript và build sản phẩm (thư mục dist)
npm run lint      # kiểm tra ESLint
npm run preview   # xem bản build
```

> Trên Windows/PowerShell dùng `npm.cmd` nếu máy chặn `npm.ps1`.

Lần đầu mở ứng dụng, hệ thống tự khởi tạo bộ dữ liệu mẫu sống theo thời điểm hiện tại (ngày tương đối so với hôm nay): 5 tổ sản xuất, 14 nhân sự, 24 nguyên vật liệu, 8 sản phẩm kèm BOM, 8 khách hàng, 16 đơn hàng ở đủ trạng thái, 20 lệnh sản xuất, ~127 phiếu sản lượng (94 phiếu trong 14 ngày, 8 phiếu hôm nay), 18 phiếu QC, 5 phiếu nhập NVL, 8 phiếu xuất NVL, 3 phiếu giao hàng và 2 kỳ lương (tháng trước đã chốt, tháng hiện tại đang mở). Dữ liệu lưu cục bộ nên tải lại trang vẫn giữ nguyên; có thể xuất/nhập bản sao lưu JSON hoặc khôi phục dữ liệu mẫu trong trang **Thiết lập** (vai trò Giám đốc xưởng).

## Phạm vi đã triển khai

| Nhóm | Nội dung |
|---|---|
| Tổng quan | KPI (lệnh đang chạy, sản lượng hôm nay, đơn đến hạn 7 ngày, đơn trễ hạn, tỷ lệ đạt QC 30 ngày, vật tư dưới định mức), money cards (giá trị đơn chờ giao, doanh thu 30 ngày, chi phí NVL, lương khoán kỳ này), biểu đồ sản lượng 14 ngày tự vẽ bằng div + Tooltip, lệnh theo công đoạn hiện tại, cảnh báo (đơn trễ, thiếu vật tư theo lệnh, lệnh làm lại), hoạt động gần đây |
| Đơn hàng | Danh sách + tiến độ % theo lệnh con, tạo đơn (chọn khách, tạo khách nhanh, dòng SP × SL × đơn giá), duyệt đơn sinh lệnh sản xuất theo BOM, giao hàng (trừ thành phẩm, chặn khi thiếu), huỷ đơn kèm huỷ lệnh chưa chạy, in đơn hàng A4 |
| Sản phẩm & BOM | Danh mục sản phẩm với giá thành sơ bộ (Σ định mức NVL × hao hụt × giá bình quân + Σ đơn giá khoán), biên tập công đoạn (tổ, đơn giá khoán, định mức phút, sắp thứ tự) và định mức nguyên vật liệu, sao chép BOM từ sản phẩm khác |
| Lệnh sản xuất | Danh sách lọc theo trạng thái/ưu tiên/tổ/quá hạn; chi tiết: timeline công đoạn (bắt đầu, hoàn thành, ghi sản lượng), panel nhu cầu & cấp vật tư theo định mức, panel sản lượng khoán, panel QC và lịch sử kiểm, nhật ký lệnh, in lệnh sản xuất A4 |
| Điều độ xưởng | Kanban theo tổ sản xuất, thẻ hiển thị mã lệnh/SL/hạn/ưu tiên/bước x/y/SL đã làm, nút **Bắt đầu** và **Xong công đoạn** tự đẩy lệnh sang tổ kế tiếp, toolbar lọc ưu tiên/tổ + tìm kiếm + legend màu |
| Sản lượng | Thống kê tốt hôm nay/7 ngày, tỷ lệ lỗi, tiền khoán ghi nhận; bảng phiếu sản lượng lọc theo ngày/tổ/lệnh/nhân viên; thêm phiếu, sửa/xoá phiếu trong ngày (Giám đốc xưởng); năng suất theo tổ 7 ngày |
| Kiểm tra chất lượng | Lệnh chờ kiểm + nút Kiểm tra, bảng phiếu QC (SL kiểm/đạt/lỗi, loại lỗi, kết quả, người kiểm), thống kê tỷ lệ đạt 30 ngày, lỗi theo loại, top lỗi theo tổ, đếm số lần làm lại |
| Kho | Tab **Vật tư** (tồn, định mức tối thiểu, giá bình quân gia quyền, giá trị tồn, nhập kho nháp/ghi sổ, kiểm kê nhanh có lý do), tab **Thành phẩm** (tồn nhập từ QC đạt, giao dịch kho gần đây), tab **Phiếu kho** (nhập NVL, xuất NVL theo lệnh, nhập TP, giao hàng; phiếu nháp có nút ghi sổ, xem chi tiết) |
| Nhân sự | Card từng tổ (tổ trưởng, số nhân viên, công đoạn phụ trách, sản lượng & tiền khoán 30 ngày) và bảng nhân viên (chức danh, tổ, sản lượng cá nhân 30 ngày); thêm/sửa tổ và nhân viên |
| Lương khoán | Chọn kỳ tháng, bảng theo nhân viên kèm chi tiết công đoạn (SL × đơn giá), dòng tổng, chốt kỳ lương lưu snapshot, lịch sử kỳ đã chốt, xuất CSV |
| Báo cáo | 4 tab: Sản lượng (ngày/tổ/công đoạn/sản phẩm), Chất lượng (theo tuần, lỗi theo loại/tổ/nhân viên), Chi phí (NVL theo sản phẩm, lương khoán theo tổ, chi phí & chênh lệch theo lệnh), Tiến độ (đơn trễ, lead time, lệnh đang chạy); lọc khoảng ngày và xuất CSV từng tab |
| Thiết lập | Thông tin xưởng, cấu hình in, thông tin ứng dụng, chuyển vai trò trải nghiệm, định dạng chứng từ + bảng cấp số, dung lượng & sao lưu/khôi phục JSON, khôi phục dữ liệu mẫu, thông tin phiên bản và liên hệ |

## Vai trò & phân quyền

| Vai trò | Mã | Trang mặc định | Phạm vi chính |
|---|---|---|---|
| Giám đốc xưởng | MANAGER | /dashboard | Toàn quyền, gồm thiết lập, lương, sửa/xoá phiếu sản lượng trong ngày |
| Kế hoạch | PLANNER | /orders | Đơn hàng, sản phẩm & BOM, lệnh sản xuất, điều độ, báo cáo |
| Tổ trưởng | SUPERVISOR | /scheduling | Lệnh sản xuất, điều độ, sản lượng, xem QC, tổ & nhân sự |
| QC | QC | /qc | Kiểm tra chất lượng, xem lệnh sản xuất |
| Thủ kho | STOREKEEPER | /materials | Kho vật tư & thành phẩm, giao hàng, xem sản phẩm & BOM |

Phân quyền được kiểm tra ở tầng route (Guard) và tầng service (`src/services/permissions.ts`), không chỉ ẩn nút giao diện.

## Kiến trúc

```text
src/
  app/           # router (HashRouter) + Guard, providers, theme AntD, ngữ cảnh vai trò
  layouts/       # khung giao diện chính (sider tối, header, tìm kiếm toàn cục, chuyển vai trò)
  modules/       # trang theo nghiệp vụ (dashboard, orders, products, work-orders, scheduling, logs, qc, materials, teams, payroll, reports, settings)
  components/    # thành phần dùng chung (PageHeader, StatusTag, GlobalSearch, PrintPreview, modal sản lượng/QC)
  db/            # kết nối Dexie, lược đồ IndexedDB, dữ liệu mẫu
  repositories/  # truy vấn tổng hợp phục vụ danh sách/tổng quan/báo cáo
  services/      # nghiệp vụ: bán hàng → sản xuất → kho → QC → lương; quyền, cấp số, sao lưu
  types/         # kiểu dữ liệu dùng chung
  utils/         # định dạng tiền/ngày, tính tiền VND, chuẩn hoá tìm kiếm, nhãn trạng thái
  styles/        # style toàn cục và mẫu in A4
```

Luồng: **Trang/Form → Service nghiệp vụ → Repository → Dexie (IndexedDB)**. Mọi thao tác nhiều bảng chạy trong một `db.transaction`, kèm ghi nhật ký hoạt động và `operationId` chống ghi trùng khi bấm lại.

## Quy trình nghiệp vụ chính

```text
Đơn hàng khách → Duyệt (sinh lệnh SX theo BOM: công đoạn + định mức NVL)
→ Cấp vật tư (trừ kho NVL, ghi phiếu xuất)
→ Công đoạn: Cắt phôi → Hàn & CNC → Sơn tĩnh điện → Lắp ráp → Đóng gói
   (bắt đầu / xong công đoạn tự đẩy sang tổ kế tiếp, ghi sản lượng khoán)
→ QC: Đạt → nhập kho thành phẩm | Không đạt → lệnh quay lại công đoạn cuối, tăng số lần làm lại
→ Giao hàng (trừ thành phẩm, cập nhật trạng thái đơn)
→ Lương khoán theo kỳ (Σ SL tốt × đơn giá công đoạn) → Báo cáo
```

Quy tắc nghiệp vụ đáng chú ý:

- Đơn chỉ được duyệt khi mọi dòng sản phẩm đã có BOM (công đoạn + nguyên vật liệu); nếu thiếu, hệ thống chặn kèm hướng dẫn bổ sung.
- Không bắt đầu được công đoạn sau khi công đoạn trước chưa xong; không hoàn thành công đoạn khi chưa ghi sản lượng.
- Sản lượng tốt mỗi công đoạn không vượt số lượng lệnh (được ghi bù khi làm lại sau QC không đạt).
- Cấp vật tư và giao hàng đều chặn khi thiếu tồn, báo rõ số lượng còn thiếu.
- QC đạt mới nhập kho thành phẩm; QC không đạt đưa lệnh về công đoạn cuối đã hoàn thành và tăng `reworkCount`.
- Giá bình quân nguyên vật liệu tính theo bình quân gia quyền sau mỗi lần nhập kho; phiếu kho nháp chưa thay đổi tồn.
- Kỳ lương đã chốt lưu snapshot (`payrollLines`) và không chốt lại.

## In ấn

- **Lệnh sản xuất A4**: tiêu đề xưởng, mã LSX, sản phẩm, số lượng, đơn hàng + khách, hạn, ưu tiên, bảng công đoạn (bước, công đoạn, tổ, đơn giá khoán, định mức) và bảng nguyên vật liệu theo định mức, ô ký (người lập lệnh / tổ trưởng / giám đốc xưởng).
- **Phiếu giao hàng A4** và **Đơn hàng A4** dùng mẫu `.print-root` với CSS `@media print` sẵn trong `src/styles/global.scss`.

## Ghi chú vận hành

- Dữ liệu thuộc vùng lưu trữ của tên miền/cổng truy cập hiện tại (IndexedDB `factoryone`); đổi địa chỉ truy cập có thể tạo vùng dữ liệu khác.
- Nên **Xuất bản sao lưu** trước khi khôi phục dữ liệu mẫu; tệp sao lưu chứa toàn bộ bảng và được kiểm tra liên kết trước khi nhập.
- Bộ dữ liệu mẫu dùng ngày tương đối so với ngày chạy nên bảng điều khiển và Kanban luôn có số liệu sống; khôi phục dữ liệu mẫu sẽ tạo lại theo ngày hiện tại.
- Toàn bộ giao diện tiếng Việt, không gọi API ngoài, không cần backend; khi triển khai thật cần bổ sung máy chủ, xác thực và phân quyền phía server.
