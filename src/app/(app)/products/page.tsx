'use client';

import { useState } from 'react';
import { Package, Plus, AlertTriangle } from 'lucide-react';
import { useActiveCompany, useActiveMembership, useTenantContext, useWorkspace } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { catalogService } from '@/services/catalog.service';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { availableStock } from '@/types/catalog';
import type { Category, Product, SupplierProfile, Warehouse } from '@/types/catalog';
import type { Role } from '@/config/rbac';
import type { TenantContext } from '@/types/common';

export default function ProductsPage() {
  const workspace = useWorkspace();
  const company = useActiveCompany();
  const membership = useActiveMembership();
  const tenant = useTenantContext();

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

  return <ProductsManager key={supplier.id} supplier={supplier} callerRole={membership.role} tenant={tenant} />;
}

function ProductsManager({ supplier, callerRole, tenant }: { supplier: SupplierProfile; callerRole: Role; tenant: TenantContext }) {
  const { data: products, reload } = useAsyncData<Product[]>(supplier.id, () => catalogService.listProductsForSupplier(supplier.id));
  const { data: warehouses } = useAsyncData<Warehouse[]>(supplier.id, () => catalogService.listWarehousesForSupplier(supplier.id));
  const { data: categories } = useAsyncData<Category[]>('product-categories', () => catalogService.listCategories());

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h1">Products &amp; inventory</h1>
          <p className="text-body text-text-secondary">Manage {supplier.name}&rsquo;s catalog and stock levels.</p>
        </div>
        <Button onClick={() => setCreating((v) => !v)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add product
        </Button>
      </div>

      {creating && warehouses && categories && (
        <NewProductForm
          supplierId={supplier.id}
          warehouses={warehouses}
          categories={categories}
          callerRole={callerRole}
          tenant={tenant}
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
                    {product.moderationStatus !== 'PUBLISHED' && (
                      <Badge tone={product.moderationStatus === 'PENDING_REVIEW' ? 'warning' : 'danger'}>
                        {product.moderationStatus === 'PENDING_REVIEW' ? 'Awaiting review' : 'Rejected'}
                      </Badge>
                    )}
                    <PriceDisplay amount={product.basePrice} size="sm" />
                    <span className={isLow ? 'text-sm font-medium text-danger' : 'text-sm text-text-secondary'}>{stock} in stock</span>
                  </div>
                </button>

                {product.moderationStatus === 'REJECTED' && product.moderationNote && (
                  <p className="border-t border-border px-4 py-2 text-caption">Admin note: {product.moderationNote}</p>
                )}

                {expandedId === product.id && (
                  <ProductEditPanel product={product} callerRole={callerRole} tenant={tenant} onSaved={reload} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProductEditPanel({
  product,
  callerRole,
  tenant,
  onSaved,
}: {
  product: Product;
  callerRole: Role;
  tenant: TenantContext;
  onSaved: () => void;
}) {
  const [basePrice, setBasePrice] = useState(String(product.basePrice));
  const [moq, setMoq] = useState(String(product.moq));
  const [stockByWarehouse, setStockByWarehouse] = useState<Record<string, string>>(
    Object.fromEntries(product.inventory.map((i) => [i.warehouseId, String(i.stock)])),
  );
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function save() {
    setSaving(true);

    const priceResult = await catalogService.updateProduct(product.id, { basePrice: Number(basePrice), moq: Number(moq) }, callerRole, tenant);
    if (!priceResult.ok) {
      toast.show(priceResult.error.message, 'error');
      setSaving(false);
      return;
    }

    for (const record of product.inventory) {
      const nextStock = Number(stockByWarehouse[record.warehouseId]);
      if (nextStock !== record.stock) {
        const invResult = await catalogService.updateInventory(product.id, record.warehouseId, { stock: nextStock }, callerRole, tenant);
        if (!invResult.ok) {
          toast.show(invResult.error.message, 'error');
          setSaving(false);
          return;
        }
      }
    }

    setSaving(false);
    toast.show('Product updated.', 'success');
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
  categories,
  callerRole,
  tenant,
  onCreated,
  onCancel,
}: {
  supplierId: string;
  warehouses: Warehouse[];
  categories: Category[];
  callerRole: Role;
  tenant: TenantContext;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [sku, setSku] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [basePrice, setBasePrice] = useState('');
  const [moq, setMoq] = useState('1');
  const [stock, setStock] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const defaultWarehouse = warehouses.find((w) => w.isDefault) ?? warehouses[0];

  async function submit() {
    if (!defaultWarehouse || !categoryId) return;
    setSaving(true);
    const result = await catalogService.createProduct(
      {
        name,
        brand,
        sku,
        supplierId,
        categoryId,
        description,
        currency: 'GHS',
        basePrice: Number(basePrice),
        moq: Number(moq) || 1,
        warehouseId: defaultWarehouse.id,
        stock: Number(stock) || 0,
        lowStockThreshold: Math.max(1, Math.round((Number(stock) || 0) * 0.2)),
      },
      callerRole,
      tenant,
    );
    setSaving(false);
    if (!result.ok) {
      toast.show(result.error.message, 'error');
      return;
    }
    toast.show(`${name} submitted for moderation review.`, 'success');
    onCreated();
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      <h2 className="text-h3">New product</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
        <Input label="SKU" value={sku} onChange={(e) => setSku(e.target.value)} />
        <Select label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Input label="Base price" type="number" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} required />
        <Input label="MOQ" type="number" value={moq} onChange={(e) => setMoq(e.target.value)} />
        <Input label="Initial stock" type="number" value={stock} onChange={(e) => setStock(e.target.value)} />
      </div>
      <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={submit} loading={saving} disabled={!name.trim() || !basePrice || !categoryId}>
          Create product
        </Button>
      </div>
    </div>
  );
}
