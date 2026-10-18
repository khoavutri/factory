import { useEffect, useRef, useState } from 'react';
import { Input, Popover, Tag, Typography } from 'antd';
import { AppstoreOutlined, DatabaseOutlined, FileTextOutlined, SearchOutlined, ToolOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { db } from '../db/database';
import { toSearchName } from '../utils/text';
import type { Customer, Material, Product, SalesOrder, WorkOrder } from '../types';

interface SearchResults {
  orders: SalesOrder[];
  workOrders: WorkOrder[];
  products: Product[];
  customers: Customer[];
  materials: Material[];
  orderLabels: Map<string, string>;
  workOrderLabels: Map<string, string>;
}

const EMPTY: SearchResults = {
  orders: [],
  workOrders: [],
  products: [],
  customers: [],
  materials: [],
  orderLabels: new Map(),
  workOrderLabels: new Map(),
};

/** Tìm nhanh toàn cục: đơn hàng, lệnh sản xuất, sản phẩm, khách hàng, nguyên vật liệu */
export function GlobalSearch() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    const kw = keyword.trim();
    if (kw.length < 2) return;
    timer.current = window.setTimeout(async () => {
      const key = toSearchName(kw);
      const [orders, workOrders, products, customers, materials] = await Promise.all([
        db.salesOrders.filter((o) => toSearchName(o.code).includes(key)).limit(4).toArray(),
        db.workOrders.filter((w) => toSearchName(w.code).includes(key)).limit(4).toArray(),
        db.products.filter((p) => p.searchName.includes(key)).limit(4).toArray(),
        db.customers.filter((c) => c.searchName.includes(key) || toSearchName(c.phone).includes(key)).limit(4).toArray(),
        db.materials.filter((m) => m.searchName.includes(key)).limit(4).toArray(),
      ]);
      const orderLabels = new Map<string, string>();
      for (const order of orders) {
        const customer = await db.customers.get(order.customerId);
        orderLabels.set(order.id, customer?.name ?? '');
      }
      const workOrderLabels = new Map<string, string>();
      for (const workOrder of workOrders) {
        const product = await db.products.get(workOrder.productId);
        workOrderLabels.set(workOrder.id, product?.name ?? '');
      }
      setResults({ orders, workOrders, products, customers, materials, orderLabels, workOrderLabels });
      setOpen(true);
    }, 250);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [keyword]);

  const go = (path: string) => {
    setOpen(false);
    setKeyword('');
    navigate(path);
  };

  const hasResults =
    results.orders.length + results.workOrders.length + results.products.length + results.customers.length + results.materials.length > 0;

  const rowStyle: React.CSSProperties = { cursor: 'pointer', padding: '6px 4px', borderBottom: '1px dashed #edf1f6' };

  const content = (
    <div style={{ width: 420, maxHeight: 440, overflowY: 'auto' }}>
      {!hasResults ? (
        <Typography.Text type="secondary">Không tìm thấy kết quả phù hợp.</Typography.Text>
      ) : (
        <div>
          {results.orders.map((order) => (
            <div key={`o-${order.id}`} style={rowStyle} onClick={() => go(`/orders/${order.id}`)}>
              <Tag icon={<FileTextOutlined />} color="purple">
                Đơn hàng
              </Tag>
              <span className="text-strong" style={{ marginInlineEnd: 8 }}>
                {order.code}
              </span>
              <span className="text-muted">{results.orderLabels.get(order.id)}</span>
            </div>
          ))}
          {results.workOrders.map((workOrder) => (
            <div key={`w-${workOrder.id}`} style={rowStyle} onClick={() => go(`/work-orders/${workOrder.id}`)}>
              <Tag icon={<ToolOutlined />} color="geekblue">
                Lệnh SX
              </Tag>
              <span className="text-strong" style={{ marginInlineEnd: 8 }}>
                {workOrder.code}
              </span>
              <span className="text-muted">
                {results.workOrderLabels.get(workOrder.id)} · SL {workOrder.quantity}
              </span>
            </div>
          ))}
          {results.products.map((product) => (
            <div key={`p-${product.id}`} style={rowStyle} onClick={() => go('/products-bom')}>
              <Tag icon={<AppstoreOutlined />} color="blue">
                Sản phẩm
              </Tag>
              <span className="text-strong" style={{ marginInlineEnd: 8 }}>
                {product.code}
              </span>
              <span className="text-muted">{product.name}</span>
            </div>
          ))}
          {results.customers.map((customer) => (
            <div key={`c-${customer.id}`} style={rowStyle} onClick={() => go('/orders')}>
              <Tag icon={<UserOutlined />} color="geekblue">
                Khách
              </Tag>
              <span className="text-strong" style={{ marginInlineEnd: 8 }}>
                {customer.name}
              </span>
              <span className="text-muted">{customer.phone}</span>
            </div>
          ))}
          {results.materials.map((material) => (
            <div key={`m-${material.id}`} style={rowStyle} onClick={() => go('/materials?tab=materials')}>
              <Tag icon={<DatabaseOutlined />} color="gold">
                Vật tư
              </Tag>
              <span className="text-strong" style={{ marginInlineEnd: 8 }}>
                {material.code}
              </span>
              <span className="text-muted">
                {material.name} · tồn {material.stockQty} {material.unit}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Popover
      open={open && keyword.trim().length >= 2}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
      content={content}
      placement="bottomLeft"
      trigger="click"
      styles={{ content: { padding: 8 } }}
    >
      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder="Tìm đơn hàng, lệnh SX, sản phẩm, khách, vật tư..."
        style={{ width: 360 }}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
      />
    </Popover>
  );
}
