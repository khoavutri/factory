# FactoryOne — Sản xuất nhỏ / xưởng gia công (MES-lite)

## 1. Định vị

- **Tên sản phẩm:** FactoryOne
- **Mô tả ngắn:** Hệ thống điều hành xưởng sản xuất nhỏ / xưởng gia công: đơn hàng → lệnh sản xuất → công đoạn → QC → kho vật tư & thành phẩm → lương khoán.
- **Địa chỉ triển khai:** https://factory.khoadev.vn
- **Màu chủ đạo:** `#4f46e5` (indigo). Sider tối `#1e1b4b`, trigger `#181445`, body `#f4f5fa`, table header `#eff0f8`.
- **Favicon:** SVG inline chữ **F** nền `#4f46e5`. Tiêu đề trang: `FactoryOne — Quản lý sản xuất & xưởng gia công`.
- **Ngôn ngữ:** tiếng Việt 100%.
- **Bối cảnh seed:** Xưởng cơ khí gia công kim loại nhỏ (thép hộp, inox, sơn tĩnh điện, xe đẩy, kệ sắt, tủ điện...).

## 2. Nền tảng kỹ thuật (bắt buộc)

- React 19 + TypeScript + Vite 8 + Ant Design 6 + dayjs + Dexie 4 (IndexedDB) + SCSS Modules + react-router-dom 7 (**HashRouter**).
- **Dự án mẫu tham chiếu — đọc kỹ và bắt chước kiến trúc + phong cách:** `C:\Users\khoadev\Desktop\Code\Khoadev\gara`
  - `src/app/theme.ts`, `src/app/providers.tsx`, `src/app/RoleContext.tsx`, `src/app/router.tsx`
  - `src/layouts/MainLayout/` (sider tối + header trắng + tìm kiếm toàn cục + chuyển vai trò)
  - `src/components/` (PageHeader, StatusTag, GlobalSearch...)
  - `src/db/database.ts` + `src/db/seed.ts` (seed phong phú, **ngày tương đối so với hiện tại**)
  - `src/services/` (core: nextCode/logActivity/settings; errors: BusinessError; permissions; backup) và `src/repositories/`
  - `src/styles/global.scss` (page-content, page-toolbar, table-scroll-x, print-root A4)
  - `src/modules/dashboard/`, `modules/workshop/` (**Kanban** — tham chiếu cho Điều độ xưởng), `modules/inventory/` (tabs), `modules/reports/`, `modules/settings/`
- **Copy nguyên từ gara (đổi tên):** `package.json` (đổi `name` thành `factory`), `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `eslint.config.js`, `.gitignore`, `vite.config.ts`, `vercel.json` (`rewrites` về `/`). Viết mới `index.html` (title + favicon riêng, `lang="vi"`).
- **npm:** dùng `npm.cmd` (PowerShell chặn `npm.ps1`). **Bắt buộc build sạch:** `npm.cmd run build` (chạy `tsc -b && vite build`) không lỗi, không biến thừa (`noUnusedLocals`/`noUnusedParameters`).
- `verbatimModuleSyntax: true` → import type phải dùng `import type`.
- Tiền VND: `formatMoney` kiểu `12.345 ₫`; ngày `dd/MM/yyyy HH:mm`. Dùng `App.useApp()` cho message/modal. AntD 6: `<Alert title=...>`, `Space orientation="vertical"`, `Tabs items=[...]`, `Popover styles={{ content: ... }}`.
- Không gọi API ngoài, không backend — toàn bộ dữ liệu Dexie, seed tự sinh khi mở lần đầu (có `ensureSeed()` + Settings cho sao lưu/khôi phục/khôi phục dữ liệu mẫu).

## 3. Vai trò & phân quyền

| Vai trò | Mã | Trang mặc định |
|---|---|---|
| Giám đốc xưởng | MANAGER | /dashboard |
| Kế hoạch | PLANNER | /orders |
| Tổ trưởng | SUPERVISOR | /scheduling |
| QC | QC | /qc |
| Thủ kho | STOREKEEPER | /materials |

- MANAGER: toàn quyền. PLANNER: dashboard, orders, products-bom, work-orders, scheduling, reports (xem). SUPERVISOR: dashboard, work-orders, scheduling, logs, qc (xem), teams (xem). QC: dashboard, qc, work-orders (xem). STOREKEEPER: dashboard, materials, products-bom (xem).
- Phân quyền ở tầng route (Guard như gara) + ẩn menu theo vai trò.

## 4. Menu & màn hình

```
Tổng quan     → /dashboard
Kinh doanh    → /orders, /orders/:id
Sản xuất      → /products-bom, /work-orders, /work-orders/:id, /scheduling, /logs, /qc
Kho           → /materials
Nhân sự       → /teams, /payroll
Quản trị      → /reports, /settings
```

### 4.1 /dashboard — Tổng quan
- KPI row: **Lệnh SX đang chạy**, **Sản lượng hôm nay** (Σ quantityGood hôm nay), **Đơn đến hạn 7 ngày tới**, **Đơn trễ hạn**, **Tỷ lệ đạt QC 30 ngày (%)**, **Vật tư dưới định mức**.
- Money row: Giá trị đơn chờ giao, Doanh thu 30 ngày (đã giao), Chi phí NVL 30 ngày (phiếu xuất), Lương khoán kỳ này (ước tính Σ logs × đơn giá công đoạn).
- Biểu đồ **sản lượng 14 ngày** (bar tự vẽ bằng div + Tooltip): tổng quantityGood/ngày, stacked theo tổ hoặc 2 màu tốt/lỗi.
- **Lệnh theo công đoạn hiện tại** (list: tên tổ/công đoạn, số lệnh — click sang /scheduling).
- **Cảnh báo cần xử lý**: đơn trễ hạn (5), NVL thiếu theo lệnh đang chạy (5), lệnh QC không đạt cần làm lại.
- **Hoạt động gần đây** (8 dòng từ activityLogs).

### 4.2 /orders — Đơn hàng
- Bảng: mã đơn `DH-...`, khách, số mặt hàng, tổng SL, giá trị, hạn giao (đỏ nếu trễ), trạng thái (Mới / Đã duyệt / Đang sản xuất / Đủ hàng / Đã giao / Huỷ), **tiến độ %** (Progress từ các lệnh SX con). Filters: trạng thái, khoảng hạn giao, search mã/khách.
- Nút **Tạo đơn** (Drawer): chọn khách (select + tạo nhanh), hạn giao, các dòng SP × SL × đơn giá (mặc định giá bán SP).
- **/orders/:id — Chi tiết:** header (mã, khách, hạn, giá trị, trạng thái) + nút hành động theo trạng thái:
  - **Duyệt đơn** → sinh **lệnh sản xuất** (mỗi dòng SP = 1 lệnh SX, copy BOM stages + materials tại thời điểm duyệt). Nếu SP chưa có BOM → chặn kèm hướng dẫn.
  - **Giao hàng** (khi có thành phẩm): modal chọn dòng + SL còn lại → POST → trừ thành phẩm, cập nhật trạng thái đơn (Đủ hàng / Đã giao từng phần). Chặn nếu thành phẩm không đủ (báo còn thiếu).
  - **Huỷ đơn** (chỉ khi Mới/Đã duyệt; nếu đã sinh lệnh SX → huỷ luôn các lệnh chưa chạy).
  - **In đơn hàng A4** (mẫu `.print-root`).
  - Bảng items + danh sách lệnh SX đã sinh (link).

### 4.3 /products-bom — Sản phẩm & BOM
- Bảng SP: mã, tên, ĐVT, giá bán, số NVL, số công đoạn, **giá thành sơ bộ** (Σ NVL × giá bình quân × (1+hao hụt) + Σ đơn giá công đoạn), trạng thái.
- Drawer/Trang sửa BOM: 2 danh sách có thể thêm/xoá và sắp thứ tự:
  - **Công đoạn (routing):** seq, tên (Cắt phôi / Hàn & CNC / Sơn tĩnh điện / Lắp ráp / Đóng gói...), tổ thực hiện, **đơn giá khoán (đ/đơn vị)**, định mức phút/đơn vị.
  - **Nguyên vật liệu:** mã NVL, định mức/1 SP, % hao hụt.
- Nút **Thêm sản phẩm** (tạo mới + copy BOM từ SP khác tuỳ chọn). Hiển thị giá thành sơ bộ cập nhật realtime trong form.

### 4.4 /work-orders — Lệnh sản xuất
- Bảng: mã lệnh `LSX-...`, sản phẩm, SL, đơn hàng, **tổ hiện tại** (công đoạn đang chạy), tiến độ công đoạn `x/y` (Progress), hạn, ưu tiên (Thấp / Thường / Cao / Gấp — tag màu), trạng thái (Chờ / Đang sản xuất / Chờ QC / Hoàn thành / Huỷ). Filters.
- **/work-orders/:id — Chi tiết (trọng tâm):**
  - Header: SP, SL, đơn hàng, hạn, tiến độ, ưu tiên, số lần làm lại.
  - **Timeline công đoạn** (Steps dọc): mỗi bước: tên, tổ, đơn giá, trạng thái (Chưa làm / Đang làm / Xong), thời gian bắt đầu-kết thúc, SL đã ghi. Nút **Bắt đầu** (bước đầu tiên) và **Hoàn thành công đoạn** (chuyển bước kế; bước cuối xong → lệnh sang **Chờ QC**).
  - **Panel vật tư:** nhu cầu theo BOM × SL, đã cấp, còn thiếu; nút **Cấp vật tư** (modal: prefill các dòng còn thiếu theo định mức, cho sửa SL → POST phiếu xuất: trừ tồn NVL, ghi phiếu kho).
  - **Panel sản lượng:** bảng phiếu sản lượng của lệnh (ngày, ca, tổ/công đoạn, nhân viên, SL tốt, SL lỗi, thành tiền khoán); nút **Thêm phiếu** (chọn công đoạn đang chạy, nhân viên thuộc tổ, SL tốt + SL lỗi — chặn vượt SL lệnh còn lại).
  - **Panel QC** (khi Chờ QC): nút **Kiểm tra** → modal: SL kiểm/SL đạt/SL lỗi, loại lỗi chính (Kích thước / Mối hàn / Bề mặt sơn / Thiếu linh kiện / Khác), kết luận **Đạt** (→ lệnh Hoàn thành, nhập kho thành phẩm, cộng tồn) hoặc **Không đạt** (→ lệnh quay lại Đang sản xuất, reworkCount++ , ghi log). Lịch sử các lần kiểm.
  - **Nhật ký** hoạt động của lệnh.

### 4.5 /scheduling — Điều độ xưởng (Kanban)
- Cột = **tổ sản xuất** (Tổ Cắt phôi, Tổ Hàn & CNC, Tổ Sơn, Tổ Lắp ráp, Tổ Đóng gói). Thẻ = công đoạn của lệnh SX đang chờ/đang làm tại tổ đó.
- Thẻ hiển thị: mã lệnh, tên SP, SL, hạn (đỏ nếu trễ), ưu tiên, `bước x/y`, SL đã làm ở bước này, nút hành động: **Bắt đầu** (Chưa làm → Đang làm) và **Xong công đoạn** (Đang làm → Xong; tự đẩy lệnh sang tổ của bước kế tiếp). Trạng thái cột: đếm số thẻ + số đang làm.
- Toolbar: search, filter ưu tiên/tổ, legend màu. Layout Kanban cuộn ngang, cột nền xám nhạt bo góc (tham chiếu `modules/workshop` của gara).

### 4.6 /logs — Sản lượng & năng suất
- Header stats: sản lượng tốt hôm nay / 7 ngày, tỷ lệ lỗi 7 ngày, tiền khoán ghi nhận 7 ngày.
- Bảng phiếu sản lượng (mã `SL-...`, ngày, ca Sáng/Chiều/Tối, lệnh SX, công đoạn, tổ, nhân viên, SL tốt, SL lỗi, thành tiền = SL tốt × đơn giá). Filters: ngày, tổ, lệnh, nhân viên.
- Nút **Thêm phiếu** (modal như 4.4). Sửa/xoá phiếu cùng ngày (chỉ MANAGER).
- **Năng suất theo tổ 7 ngày** (list/Progress bars: SL tốt & tỷ lệ lỗi mỗi tổ).

### 4.7 /qc — Kiểm tra chất lượng
- Khối "**Lệnh chờ kiểm**": list lệnh SX trạng thái Chờ QC (mã, SP, SL, tổ cuối, thời gian chờ) + nút **Kiểm tra** (modal như 4.4).
- Bảng phiếu QC: mã `QC-...`, lệnh SX, SP, SL kiểm/đạt/lỗi, loại lỗi, kết quả (Đạt / Không đạt / Làm lại — tag), người kiểm, ngày. Filters.
- Thống kê: tỷ lệ đạt 30 ngày (Progress tròn/lớn), lỗi theo loại (list đếm + bar ngang), số lần làm lại 30 ngày, top lỗi theo tổ.

### 4.8 /materials — Kho vật tư & thành phẩm (3 tabs)
- **Vật tư:** bảng NVL (mã, tên, ĐVT, tồn, định mức tối thiểu, giá bình quân, giá trị tồn, badge "Thiếu"); nút **Nhập kho** (modal: NCC + dòng NVL × SL × đơn giá → POST: cộng tồn, cập nhật **giá bình quân gia quyền**, phiếu kho). Thêm/sửa NVL. **Kiểm kê nhanh**: nhập tồn thực tế → điều chỉnh có lý do.
- **Thành phẩm:** bảng SP (mã, tên, tồn TP, giá thành sơ bộ, giá trị); movements nhập từ lệnh hoàn thành / xuất giao hàng gần đây.
- **Phiếu kho:** bảng tổng hợp chứng từ (mã, loại: Nhập NVL / Xuất NVL theo lệnh / Nhập TP / Giao hàng, liên quan (NCC/lệnh/đơn), số dòng, giá trị, trạng thái, ngày); click xem chi tiết (Drawer); phiếu nháp có nút ghi sổ/huỷ.

### 4.9 /teams — Tổ & nhân sự (2 tabs)
- **Tổ sản xuất:** card mỗi tổ: mã, tên, tổ trưởng, số nhân viên, các công đoạn tổ đang phụ trách, **sản lượng 30 ngày**, tiền khoán 30 ngày. Thêm/sửa.
- **Nhân viên:** bảng (mã `NV-...`, tên, chức danh (Giám đốc xưởng / Kế hoạch / Tổ trưởng / Thợ chính / Thợ phụ / QC / Thủ kho), tổ, SĐT, trạng thái, sản lượng cá nhân 30 ngày). Thêm/sửa.

### 4.10 /payroll — Lương khoán
- Chọn kỳ (mặc định tháng hiện tại; cho chọn tháng). Bảng theo nhân viên: tổ, SL tốt, SL lỗi, số phiếu, **thành tiền** (Σ SL tốt theo từng công đoạn × đơn giá công đoạn). Expand row → chi tiết theo công đoạn (SL × đơn giá).
- Dòng tổng; nút **Chốt kỳ lương** (lưu snapshot `payrollLines`, trạng thái LOCKED; kỳ đã chốt ẩn nút, hiện tag "Đã chốt") và **Xuất CSV**.

### 4.11 /reports — Báo cáo (4 tabs)
- **Sản lượng:** theo ngày (bảng + bar), theo tổ, theo công đoạn, theo sản phẩm. **Chất lượng:** tỷ lệ đạt theo tuần, lỗi theo loại, theo tổ/nhân viên. **Chi phí:** NVL theo sản phẩm/lệnh, lương khoán theo kỳ/tổ, tổng chi phí ước tính theo lệnh. **Tiến độ:** đơn trễ, lead time trung bình (ngày từ duyệt → giao). Mỗi tab filter khoảng ngày + nút **Xuất CSV** từng bảng. Dùng Statistic/Progress/Table đơn giản như gara.

### 4.12 /settings — Thiết lập
- Thông tin xưởng (tên "Xưởng Cơ khí KhoaDev", địa chỉ, MST, điện thoại, người đại diện), cấu hình in (footer phiếu), sao lưu / khôi phục JSON / khôi phục dữ liệu mẫu, thông tin KhoaDev (khoadev.vn — khoadev.company@gmail.com).

## 5. Mô hình dữ liệu (Dexie — gợi ý, có thể điều chỉnh nhẹ)

```
teams(id, &code, name, leaderId?, active)
employees(id, &code, name, role, position, teamId?, phone, active)
suppliers(id, &code, name, phone, address, active)
materials(id, &code, name, unit, stockQty, minQty, avgCostVnd, active, searchName)
products(id, &code, name, unit, salePriceVnd, active)
bomStages(id, productId, seq, name, teamId, pieceRateVnd, standardMinutes)
bomMaterials(id, productId, materialId, quantityPerUnit, wastePct)
customers(id, &code, name, phone, address?, note?)
salesOrders(id, &code, customerId, status, dueDate, totalVnd, createdAt, note?)
salesOrderItems(id, orderId, productId, quantity, unitPriceVnd, deliveredQty)
workOrders(id, &code, salesOrderId, salesOrderItemId, productId, quantity, status, priority, dueDate, reworkCount, createdAt)
workOrderStages(id, workOrderId, seq, name, teamId, pieceRateVnd, status, startedAt?, finishedAt?)
productionLogs(id, &code, workOrderId, stageId, teamId, employeeId, shift, date, quantityGood, quantityBad, createdAt, note?)
qcChecks(id, &code, workOrderId, checkedQty, passedQty, failedQty, defectType, result, note?, checkedById, checkedAt)
materialReceipts(id, &code, supplierId, status, totalVnd, createdAt, postedAt?)
materialReceiptItems(id, receiptId, materialId, quantity, unitCostVnd)
materialIssues(id, &code, workOrderId, status, createdAt, postedAt?)
materialIssueItems(id, issueId, materialId, quantity, unitCostVnd)
deliveries(id, &code, salesOrderId, status, note?, createdAt, deliveredAt?)
deliveryItems(id, deliveryId, productId, quantity)
stockMovements(id, materialId?, productId?, type, quantity, unitCostVnd?, refType, refId, at, note?)
productStock(id, &productId, productId, quantity)
payrollPeriods(id, &code, from, to, status, lockedAt?)
payrollLines(id, periodId, employeeId, quantityTotal, amountVnd)
settings(key, value)  // WORKSHOP_INFO, PRINT_CONFIG, APP_META...
activityLogs(id, [entityType+entityId], at, actorName, summary, entityType, entityId)
documentSequences(id, [type+period], lastNumber)
```

- Chứng từ: `DH-` (đơn hàng), `LSX-` (lệnh SX), `SL-` (phiếu sản lượng), `QC-`, `PN-` (nhập kho), `PX-` (xuất NVL), `GH-` (giao hàng), `LK-` (kỳ lương).
- Thao tác nhiều bảng nằm trong `db.transaction` + log activity. `operationId` chống ghi trùng theo pattern gara (`services/errors.ts`, `hooks/useAction.ts`).
- `stockMovements` dùng chung cho NVL (RECEIPT_IN / ISSUE_OUT / ADJUST) và thành phẩm (PRODUCT_IN / DELIVERY_OUT).

## 6. Quy trình nghiệp vụ chính

```
Đơn hàng khách → Duyệt (sinh lệnh SX theo BOM) → Cấp vật tư (trừ kho NVL)
→ Các công đoạn: Cắt → Hàn/CNC → Sơn → Lắp ráp → Đóng gói (bắt đầu/kết thúc, ghi sản lượng)
→ QC (đạt → nhập kho thành phẩm | không đạt → làm lại, đếm rework)
→ Giao hàng (trừ thành phẩm) → Lương khoán theo sản lượng → Báo cáo
```

## 7. Dữ liệu mẫu (seed) — yêu cầu chi tiết

- **5 tổ:** Tổ Cắt phôi (TO1), Tổ Hàn & CNC (TO2), Tổ Sơn (TO3), Tổ Lắp ráp (TO4), Tổ Đóng gói (TO5).
- **~14 nhân viên:** 1 giám đốc xưởng (Đặng Quốc Hưng), 1 kế hoạch (Nguyễn Thu Hằng), 5 tổ trưởng, ~5 thợ chính, 1 QC (Trịnh Văn Lâm), 1 thủ kho (Bùi Thị Oanh). Tên VN, SĐT.
- **8 sản phẩm cơ khí:** Khung thép hộp mạ kẽm 1200×600, Kệ sắt 5 tầng 1.5m, Bàn inox 2 tầng 800×600, Xe đẩy hàng 4 bánh, Vỏ tủ điện 600×400, Lan can ban công sắt hộp, Cửa sắt kéo CNC 2 cánh, Trục xe đẩy tải 300kg. Mỗi SP BOM 3–5 NVL + 3–5 công đoạn với đơn giá khoán thực tế (Cắt 15k, Hàn 35k, Sơn 20k, Lắp ráp 25k, Đóng gói 5k...).
- **~24 NVL:** Thép hộp 20×40×1.2, Thép hộp 25×50×1.4, Thép tấm 2mm, Thép V 30×30, Ống kẽm Ø21, Que hàn J421 2.5, Bulong M8×30, Đai ốc M8, Long đền, Bạc đạn 6204, Bánh xe PU 100mm, Bánh xe nhựa 75mm, Bản lề inox, Tay nắm inox, Sơn tĩnh điện bột (kg), Dung môi, Giấy nhám, Khớp nối, Xích con lăn, Tăng đơ, Chân nhựa, Đệm cao su, Ống nhựa, Dây đai. 5 NVL tồn dưới định mức.
- **8 khách (đa số B2B):** Cty TNHH Nội thất Phố, Cửa hàng VLXD Hòa Phát, Xưởng mộc Đức Long, Cty Điện lạnh Sài Gòn, Cty Bao bì Tân Tiến, Nhà máy Gạch Bình Dương, Cty Thực phẩm Vina, Hộ kinh doanh Minh Khuê + SĐT/địa chỉ.
- **~16 đơn hàng** đủ trạng thái: 2 Mới, 2 Đã duyệt, 6 Đang sản xuất (có lệnh SX), 2 Đủ hàng, 3 Đã giao (đã có doanh thu 30 ngày), 1 Huỷ. **2 đơn quá hạn** để dashboard có cảnh báo.
- **~22 lệnh SX** với công đoạn ở đủ mọi tiến độ: nhiều lệnh đang chạy ở các tổ khác nhau (Kanban mỗi cột có 2–4 thẻ, có cả thẻ Chưa làm đầu cột sau), 2 lệnh Chờ QC, 3 lệnh Hoàn thành (đã nhập kho thành phẩm), 1 lệnh từng QC không đạt (reworkCount ≥ 1).
- **~90 phiếu sản lượng** 14 ngày gần đây (~8 phiếu hôm nay), SL tốt/lỗi hợp lý, gắn đúng công đoạn + tổ + nhân viên.
- **~14 phiếu QC** (30 ngày): ~85% đạt, lỗi đủ loại (Mối hàn, Kích thước, Bề mặt sơn, Thiếu bulong, Khác).
- **Kho:** 5 phiếu nhập NVL (3 đã ghi sổ, 2 nháp), 8 phiếu xuất NVL theo lệnh (5 đã ghi sổ), 3 phiếu giao hàng đã ghi sổ.
- **Lương:** kỳ tháng hiện tại đang mở (OPEN) với dữ liệu có sẵn; 1 kỳ tháng trước đã chốt.
- **Activity logs ~15** mô tả duyệt đơn/tạo lệnh/nhập kho/QC.

## 8. In ấn

- **Lệnh sản xuất** (A4 `.print-root`): header xưởng, mã LSX, sản phẩm, SL, đơn hàng + khách, hạn, ưu tiên, bảng công đoạn (seq, tên, tổ, đơn giá khoán) + bảng NVL theo định mức, ô ký (Người lập / Tổ trưởng / Giám đốc).
- **Phiếu giao hàng** A4: header, mã GH, đơn hàng, khách, bảng SP × SL, người nhận ký.
- **Đơn hàng** A4 (mẫu báo giá-like).

## 9. Nghiệm thu

- `npm.cmd install` + `npm.cmd run build` thành công (tsc + vite build).
- Chạy `npm.cmd run dev` mở được, đổi vai trò, seed hiển thị đủ đẹp: dashboard có số liệu, Kanban mỗi tổ có thẻ, chi tiết lệnh SX thao tác được (bắt đầu/xong công đoạn, cấp vật tư, ghi sản lượng, QC đạt → nhập kho thành phẩm).
- README.md tiếng Việt theo cấu trúc README của gara (giới thiệu, chạy dự án, phạm vi đã triển khai, kiến trúc, quy trình, ghi chú vận hành).
- Toàn bộ file UTF-8, giao diện tiếng Việt, không lỗi TypeScript, không console error khi thao tác chính.
