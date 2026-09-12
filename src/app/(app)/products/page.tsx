'use client';

import { useState } from 'react';
import { Package, Plus, AlertTriangle } from 'lucide-react';
import { useActiveCompany, useActiveMembership, useWorkspace } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { catalogService } from '@/services/catalog.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { availableStock } from '@/types/catalog';
import type { Product, SupplierProfile, Warehouse } from '@/types/catalog';
import type { Role } from '@/config/rbac';

export default function ProductsPage() {
  const workspace = useWorkspace();
  const company = useActiveCompany();
  const membership = useActiveMembership();

  if (workspace !== 'supplier') {
    return (
      <ErrorState
        title="Not available"
        description="Product and inventory management is part of the supplier workspace."
      />
    );
  }

  if (!company || !membership) return null;
  const supplier = catalogService.getSupplierByCompanyId(company.id);
  if (!supplier) return null;

  return <ProductsManager key={supplier.id} supplier={supplier} callerRole={membership.role} />;
}

function ProductsManager({ supplier, callerRole }: { supplier: SupplierProfile; callerRole: Role }) {
  const { data: products, reload } = useAsyncData<Product[]>(supplier.id, () => catalogService.listProductsForSupplier(supplier.id));
  const { data: warehouses } = useAsyncData<Warehouse[]>(supplier.id, () => catalogService.listWarehousesForSupplier(supplier.id));

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1">Products &amp; inventory</h1>
          <p className="text-body text-text-secondary">Manage {supplier.name}&rsquo;s catalog and stock levels.</p>
        </div>
        <Button onClick={() => setCreating((v) => !v)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add product
        </Button>
      </div>

      {creating && warehouses && (
        <NewProductForm
          supplierId={supplier.id}
          warehouses={warehouses}
          callerRole={callerRole}
          onCreated={() => {
            setCreating(false);
            reload();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {products === null ? (
        <SkeletonTable rows={5} columns={4} />
      ) : products.length === 0 ? (
        <EmptyState icon={Package} title="No products yet" description="Add your first product to start selling on the platform." />
      ) : (
        <div className="flex flex-col gap-3">
          {products.map((product) => {
            const stock = availableStock(product);
            const isLow = product.inventory.some((i) => i.stock - i.reserved <= i.lowStockThreshold);
            return (
              <div key={product.id} className="rounded-lg border border-border bg-surface">
                <button
                  type="button"
                  onClick={() => setExpandedId(expandedId === product.id ? null : product.id)}
                  className="flex w-full items-center justify-between gap-4 p-4 text-left"
                >
                  <div>
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      {product.name}
                      {isLow && <AlertTriangle className="h-3.5 w-3.5 text-danger" aria-hidden="true" />}
                    </p>
                    <p className="text-caption">{product.sku}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <PriceDisplay amount={product.basePrice} size="sm" />
                    <span className={isLow ? 'text-sm font-medium text-danger' : 'text-sm text-text-secondary'}>{stock} in stock</span>
                  </div>
                </button>

                {expandedId === product.id && (
                  <ProductEditPanel product={product} callerRole={callerRole} onSaved={reload} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProductEditPanel({ product, callerRole, onSaved }: { product: Product; callerRole: Role; onSaved: () => void }) {
  const [basePrice, setBasePrice] = useState(String(product.basePrice));
  const [moq, setMoq] = useState(String(product.moq));
  const [stockByWarehouse, setStockByWarehouse] = useState<Record<string, string>>(
    Object.fromEntries(product.inventory.map((i) => [i.warehouseId, String(i.stock)])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);

    const priceResult = await catalogService.updateProduct(product.id, { basePrice: Number(basePrice), moq: Number(moq) }, callerRole);
    if (!priceResult.ok) {
      setError(priceResult.error.message);
      setSaving(false);
      return;
    }

    for (const record of product.inventory) {
      const nextStock = Number(stockByWarehouse[record.warehouseId]);
      if (nextStock !== record.stock) {
        const invResult = await catalogService.updateInventory(product.id, record.warehouseId, { stock: nextStock }, callerRole);
        if (!invResult.ok) {
          setError(invResult.error.message);
          setSaving(false);
          return;
        }
      }
    }

    setSaving(false);
    onSaved();
  }

  return (
    <div className="flex flex-col gap-4 border-t border-border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Base price" type="number" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} />
        <Input label="MOQ" type="number" value={moq} onChange={(e) => setMoq(e.target.value)} />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Stock by warehouse</p>
        {product.inventory.map((record) => (
          <div key={record.warehouseId} className="flex items-center gap-3">
            <span className="w-40 shrink-0 text-caption">{record.warehouseId.replace('wh-', '').replace(/-/g, ' ')}</span>
            <Input
              type="number"
              value={stockByWarehouse[record.warehouseId] ?? ''}
              onChange={(e) => setStockByWarehouse({ ...stockByWarehouse, [record.warehouseId]: e.target.value })}
              className="w-32"
            />
            <span className="text-caption">reserved {record.reserved} · threshold {record.lowStockThreshold}</span>
          </div>
        ))}
      </div>

      {error && <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}

      <div>
        <Button size="sm" onClick={save} loading={saving}>
          Save changes
        </Button>
      </div>
    </div>
  );
}

function NewProductForm({
  supplierId,
  warehouses,
  callerRole,
  onCreated,
  onCancel,
}: {
  supplierId: string;
  warehouses: Warehouse[];
  callerRole: Role;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [sku, setSku] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [moq, setMoq] = useState('1');
  const [stock, setStock] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultWarehouse = warehouses.find((w) => w.isDefault) ?? warehouses[0];

  async function submit() {
    if (!defaultWarehouse) return;
    setSaving(true);
    setError(null);
    const result = await catalogService.createProduct(
      {
        name,
        brand,
        sku,
        supplierId,
        categoryId: 'cat-networking',
        description,
        currency: 'GHS',
        basePrice: Number(basePrice),
        moq: Number(moq) || 1,
        warehouseId: defaultWarehouse.id,
        stock: Number(stock) || 0,
        lowStockThreshold: Math.max(1, Math.round((Number(stock) || 0) * 0.2)),
      },
      callerRole,
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onCreated();
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      <h2 className="text-h3">New product</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
        <Input label="SKU" value={sku} onChange={(e) => setSku(e.target.value)} />
        <Input label="Base price" type="number" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} required />
        <Input label="MOQ" type="number" value={moq} onChange={(e) => setMoq(e.target.value)} />
        <Input label="Initial stock" type="number" value={stock} onChange={(e) => setStock(e.target.value)} />
      </div>
      <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />

      {error && <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={submit} loading={saving} disabled={!name.trim() || !basePrice}>
          Create product
        </Button>
      </div>
    </div>
  );
}
