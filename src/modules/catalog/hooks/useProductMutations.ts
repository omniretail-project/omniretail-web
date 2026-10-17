"use client";

import { useMemo, useState } from "react";
import type { Product } from "@/core/entities";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { ArchiveProductService } from "@/modules/catalog/application/services/ArchiveProductService";
import { CreateProductService } from "@/modules/catalog/application/services/CreateProductService";
import { CreateProductWithCommercialDataService } from "@/modules/catalog/application/services/CreateProductWithCommercialDataService";
import { RestoreProductService } from "@/modules/catalog/application/services/RestoreProductService";
import { UpdateProductService } from "@/modules/catalog/application/services/UpdateProductService";
import { UpdateProductWithCommercialDataService } from "@/modules/catalog/application/services/UpdateProductWithCommercialDataService";
import { cleanError } from "@/modules/catalog/application/services/serviceHelpers";
import type { CreateProductDto } from "@/modules/catalog/application/dto/CreateProductDto";
import type { ProductEditorDto } from "@/modules/catalog/application/dto/ProductEditorDto";
import type { UpdateProductDto } from "@/modules/catalog/application/dto/UpdateProductDto";

export function useProductMutations() {
  const repositories = useRepositories();
  const createService = useMemo(() => new CreateProductService(repositories), [repositories]);
  const updateService = useMemo(() => new UpdateProductService(repositories), [repositories]);
  const createWithCommercialDataService = useMemo(
    () => new CreateProductWithCommercialDataService(repositories),
    [repositories],
  );
  const updateWithCommercialDataService = useMemo(
    () => new UpdateProductWithCommercialDataService(repositories),
    [repositories],
  );
  const archiveService = useMemo(() => new ArchiveProductService(repositories), [repositories]);
  const restoreService = useMemo(() => new RestoreProductService(repositories), [repositories]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runMutation(action: () => Promise<Product>) {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (caughtError) {
      const message = cleanError(caughtError);
      setError(message);
      if (caughtError instanceof Error) throw caughtError;
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    clearError: () => setError(null),
    create: (dto: CreateProductDto) => runMutation(() => createService.execute(dto)),
    update: (productId: string, dto: UpdateProductDto) =>
      runMutation(() => updateService.execute(productId, dto)),
    createWithCommercialData: (dto: ProductEditorDto) =>
      runMutation(() => createWithCommercialDataService.execute(dto)),
    updateWithCommercialData: (productId: string, dto: ProductEditorDto) =>
      runMutation(() => updateWithCommercialDataService.execute(productId, dto)),
    archive: (productId: string) => runMutation(() => archiveService.execute(productId)),
    restore: (productId: string) => runMutation(() => restoreService.execute(productId)),
  };
}
