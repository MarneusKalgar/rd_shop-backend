import { e2eRequest } from './request';
import { getConfiguredProductId } from './validation-config';

interface ProductBody {
  id: string;
  stock: number;
}

/** Resolves the product under test, preferring a workflow-pinned validation product when present. */
export async function resolveE2EProductId(minStock: number): Promise<string> {
  const configuredProductId = getConfiguredProductId();

  if (configuredProductId) {
    const res = await e2eRequest('get', `/api/v1/products/${configuredProductId}`).expect(200);
    const { data: product } = res.body as unknown as { data: ProductBody };

    if (product.stock < minStock) {
      throw new Error(
        `Configured validation product ${configuredProductId} has stock=${product.stock}, expected at least ${minStock}`,
      );
    }

    return product.id;
  }

  const res = await e2eRequest('get', '/api/v1/products').expect(200);
  const { data: products } = res.body as unknown as { data: ProductBody[] };
  const available = products.find((product) => product.stock >= minStock);

  if (!available) {
    throw new Error(`No product with stock >= ${minStock} found in seed data`);
  }

  return available.id;
}
