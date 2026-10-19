"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type {
  AddressRepository,
  AttributeRepository,
  AuditLogRepository,
  AuthRepository,
  BankAccountRepository,
  BranchRepository,
  BusinessConfigRepository,
  EmailSenderConfigRepository,
  CashShiftRepository,
  CashMovementRepository,
  CatalogImageAssetRepository,
  CategoryRepository,
  CustomerPaymentMethodRepository,
  CustomerRepository,
  DispatchCommandRepository,
  DispatchReadRepository,
  LogisticsHistoryReadRepository,
  DispatchRepository,
  InventoryAdjustmentRepository,
  InventoryRepository,
  IncidentTypeRepository,
  InventoryTransferRepository,
  InventoryTransferRequestRepository,
  NotificationRepository,
  OrderPaymentConfirmationRepository,
  OrderRepository,
  PaymentRepository,
  PackingRepository,
  PackingReadRepository,
  PackingCommandRepository,
  PickingRepository,
  PickingReadRepository,
  PickingCommandRepository,
  PlanRepository,
  PosApiRepository,
  ProductMediaRepository,
  ProductKitComponentRepository,
  ProductPriceHistoryRepository,
  ProductRepository,
  ProductSalesPriceTierRepository,
  PromotionRepository,
  PurchaseOrderRepository,
  ReceiptRepository,
  RoleRepository,
  SaleConfirmationRepository,
  SaleReversalRepository,
  SalesRepository,
  SavedPaymentMethodRepository,
  StorePickupDeliveryRepository,
  StorePickupHandoverCommandRepository,
  SupplierProductRepository,
  SupplierRepository,
  TenantOnboardingRepository,
  TenantRepository,
  TenantSubscriptionRepository,
  UnitRepository,
  UserRepository,
} from "@/core/repositories";
import { isApiMode } from "@/config/api-mode";
import { withApiSession } from "@/infrastructure/api/withApiSession";
import { withApiCatalogMasterData } from "@/infrastructure/api/withApiCatalogMasterData";
import { withApiProducts } from "@/infrastructure/api/withApiProducts";
import { withApiProductRelations } from "@/infrastructure/api/withApiProductRelations";
import { withApiInventoryMovements } from "@/infrastructure/api/withApiInventoryMovements";
import { withApiInventoryStock } from "@/infrastructure/api/withApiInventoryStock";
import { withApiInventoryTransfers } from "@/infrastructure/api/withApiInventoryTransfers";
import { withApiPurchaseOrders } from "@/infrastructure/api/withApiPurchaseOrders";
import { withApiReceiving } from "@/infrastructure/api/withApiReceiving";
import { withApiLogisticsPickingRead } from "@/infrastructure/api/withApiLogisticsPickingRead";
import { withApiLogisticsPacking } from "@/infrastructure/api/withApiLogisticsPacking";
import { withApiLogisticsDispatch } from "@/infrastructure/api/withApiLogisticsDispatch";
import { withApiPos } from "@/infrastructure/api/withApiPos";
import { withApiLogisticsHistory } from "@/infrastructure/api/withApiLogisticsHistory";
import { withApiStorePickupHandover } from "@/infrastructure/api/withApiStorePickupHandover";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import {
  getReferenceDataCache,
  referenceDataKeys,
  referenceDataPrefixes,
} from "@/shared/utils/requestCache";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import {
  MockAddressRepository,
  MockAttributeRepository,
  MockAuditLogRepository,
  MockAuthRepository,
  MockBankAccountRepository,
  MockBranchRepository,
  MockBusinessConfigRepository,
  MockCashShiftRepository,
  MockCashMovementRepository,
  MockCategoryRepository,
  MockCustomerPaymentMethodRepository,
  MockCustomerRepository,
  MockDispatchRepository,
  MockEmailSenderConfigRepository,
  MockInventoryAdjustmentRepository,
  MockInventoryRepository,
  MockIncidentTypeRepository,
  MockInventoryTransferRepository,
  MockInventoryTransferRequestRepository,
  MockNotificationRepository,
  MockOrderPaymentConfirmationRepository,
  MockOrderRepository,
  MockPaymentRepository,
  MockPackingRepository,
  MockPickingRepository,
  MockPlanRepository,
  MockProductMediaRepository,
  MockProductKitComponentRepository,
  MockProductPriceHistoryRepository,
  MockProductRepository,
  MockProductSalesPriceTierRepository,
  MockPromotionRepository,
  MockPurchaseOrderRepository,
  MockReceiptRepository,
  MockRoleRepository,
  MockSaleConfirmationRepository,
  MockSaleReversalRepository,
  MockSalesRepository,
  MockStorePickupDeliveryRepository,
  MockSupplierProductRepository,
  MockSupplierRepository,
  MockTenantOnboardingRepository,
  MockTenantRepository,
  MockTenantSubscriptionRepository,
  MockUnitRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { IndexedDbCatalogImageAssetRepository } from "@/infrastructure/media/IndexedDbCatalogImageAssetRepository";

export interface RepositoryRegistry {
  productDataSource: "mock" | "api";
  productRelationsDataSource: "mock" | "api";
  productMediaDataSource: "mock" | "api";
  inventoryMovementsDataSource: "mock" | "api";
  inventoryStockDataSource: "mock" | "api";
  inventoryTransfersDataSource: "mock" | "api";
  purchaseOrdersDataSource: "mock" | "api";
  receivingDataSource: "mock" | "api";
  pickingReadDataSource?: "mock" | "api";
  pickingCommandsEnabled?: boolean;
  packingDataSource: "mock" | "api";
  dispatchReadDataSource: "mock" | "api";
  posDataSource: "mock" | "api";
  posApi?: PosApiRepository;
  logisticsHistoryDataSource: "mock" | "api";
  tenants: TenantRepository;
  tenantOnboarding: TenantOnboardingRepository;
  businessConfig: BusinessConfigRepository;
  emailSender: EmailSenderConfigRepository;
  plans: PlanRepository;
  tenantSubscriptions: TenantSubscriptionRepository;
  auth: AuthRepository;
  users: UserRepository;
  roles: RoleRepository;
  branches: BranchRepository;
  products: ProductRepository;
  productKitComponents: ProductKitComponentRepository;
  productPriceHistory: ProductPriceHistoryRepository;
  productSalesPriceTiers: ProductSalesPriceTierRepository;
  categories: CategoryRepository;
  units: UnitRepository;
  attributes: AttributeRepository;
  promotions: PromotionRepository;
  inventoryAdjustments: InventoryAdjustmentRepository;
  incidentTypes: IncidentTypeRepository;
  inventory: InventoryRepository;
  inventoryTransfers: InventoryTransferRepository;
  inventoryTransferRequests: InventoryTransferRequestRepository;
  suppliers: SupplierRepository;
  supplierProducts: SupplierProductRepository;
  purchaseOrders: PurchaseOrderRepository;
  receipts: ReceiptRepository;
  customers: CustomerRepository;
  customerPaymentMethods: CustomerPaymentMethodRepository;
  savedPaymentMethods: SavedPaymentMethodRepository;
  addresses: AddressRepository;
  orders: OrderRepository;
  orderPaymentConfirmations: OrderPaymentConfirmationRepository;
  payments: PaymentRepository;
  bankAccounts: BankAccountRepository;
  sales: SalesRepository;
  saleConfirmations: SaleConfirmationRepository;
  saleReversals: SaleReversalRepository;
  cashShifts: CashShiftRepository;
  cashMovements: CashMovementRepository;
  picking: PickingRepository;
  pickingRead?: PickingReadRepository;
  pickingCommands?: PickingCommandRepository;
  packings: PackingRepository;
  packingRead?: PackingReadRepository;
  packingCommands?: PackingCommandRepository;
  productMedia: ProductMediaRepository;
  catalogImageAssets: CatalogImageAssetRepository;
  dispatches: DispatchRepository;
  dispatchRead?: DispatchReadRepository;
  logisticsHistory?: LogisticsHistoryReadRepository;
  dispatchCommands?: DispatchCommandRepository;
  storePickupDeliveries: StorePickupDeliveryRepository;
  storePickupHandoverCommands?: StorePickupHandoverCommandRepository;
  notifications: NotificationRepository;
  auditLogs: AuditLogRepository;
}

interface RepositoryContextValue {
  repositories: RepositoryRegistry;
  eventBus: DataEventBus;
  resetMockData: () => void;
}

const RepositoryContext = createContext<RepositoryContextValue | null>(null);

export function RepositoryProvider({ children }: { children: ReactNode }) {
  const value = useMemo<RepositoryContextValue>(() => {
    const storage = new LocalStorageAdapter();
    const store = new MockDatabaseStore(storage);
    const eventBus = new DataEventBus();
    const customerPaymentMethods = new MockCustomerPaymentMethodRepository(store, eventBus);
    const mockRepositories: RepositoryRegistry = {
      productDataSource: "mock",
      productRelationsDataSource: "mock",
      productMediaDataSource: "mock",
      inventoryMovementsDataSource: "mock",
      inventoryStockDataSource: "mock",
      inventoryTransfersDataSource: "mock",
      purchaseOrdersDataSource: "mock",
      receivingDataSource: "mock",
      pickingReadDataSource: "mock",
      pickingCommandsEnabled: true,
      packingDataSource: "mock",
      dispatchReadDataSource: "mock",
      posDataSource: "mock",
      logisticsHistoryDataSource: "mock",
      tenants: new MockTenantRepository(store, eventBus),
      tenantOnboarding: new MockTenantOnboardingRepository(store, eventBus),
      businessConfig: new MockBusinessConfigRepository(store, eventBus),
      emailSender: new MockEmailSenderConfigRepository(store, eventBus),
      plans: new MockPlanRepository(store, eventBus),
      tenantSubscriptions: new MockTenantSubscriptionRepository(store, eventBus),
      auth: new MockAuthRepository(store, eventBus, storage),
      users: new MockUserRepository(store, eventBus),
      roles: new MockRoleRepository(store, eventBus),
      branches: new MockBranchRepository(store, eventBus),
      products: new MockProductRepository(store, eventBus),
      productKitComponents: new MockProductKitComponentRepository(store, eventBus),
      productPriceHistory: new MockProductPriceHistoryRepository(store, eventBus),
      productSalesPriceTiers: new MockProductSalesPriceTierRepository(store, eventBus),
      categories: new MockCategoryRepository(store, eventBus),
      units: new MockUnitRepository(store, eventBus),
      attributes: new MockAttributeRepository(store, eventBus),
      promotions: new MockPromotionRepository(store, eventBus),
      inventoryAdjustments: new MockInventoryAdjustmentRepository(store, eventBus),
      incidentTypes: new MockIncidentTypeRepository(store, eventBus),
      inventory: new MockInventoryRepository(store, eventBus),
      inventoryTransfers: new MockInventoryTransferRepository(store, eventBus),
      inventoryTransferRequests: new MockInventoryTransferRequestRepository(store, eventBus),
      suppliers: new MockSupplierRepository(store, eventBus),
      supplierProducts: new MockSupplierProductRepository(store, eventBus),
      purchaseOrders: new MockPurchaseOrderRepository(store, eventBus),
      receipts: new MockReceiptRepository(store, eventBus),
      customers: new MockCustomerRepository(store, eventBus),
      customerPaymentMethods,
      savedPaymentMethods: customerPaymentMethods,
      addresses: new MockAddressRepository(store, eventBus),
      orders: new MockOrderRepository(store, eventBus),
      orderPaymentConfirmations: new MockOrderPaymentConfirmationRepository(store, eventBus),
      payments: new MockPaymentRepository(store, eventBus),
      bankAccounts: new MockBankAccountRepository(store, eventBus),
      sales: new MockSalesRepository(store, eventBus),
      saleConfirmations: new MockSaleConfirmationRepository(store, eventBus),
      saleReversals: new MockSaleReversalRepository(store, eventBus),
      cashShifts: new MockCashShiftRepository(store, eventBus),
      cashMovements: new MockCashMovementRepository(store, eventBus),
      picking: new MockPickingRepository(store, eventBus),
      packings: new MockPackingRepository(store, eventBus),
      productMedia: new MockProductMediaRepository(store, eventBus),
      catalogImageAssets: new IndexedDbCatalogImageAssetRepository(),
      dispatches: new MockDispatchRepository(store, eventBus),
      storePickupDeliveries: new MockStorePickupDeliveryRepository(store, eventBus),
      notifications: new MockNotificationRepository(store, eventBus),
      auditLogs: new MockAuditLogRepository(store, eventBus),
    };
    // Modo api: la sesion, los maestros migrados de Catalog y Product core usan el backend real.
    // El adapter de ubicaciones delega al mock operaciones de Inventory ajenas al maestro, pero
    // los flujos Product API no lo consultan ni escriben UUID reales en relaciones mock.
    // Modo mock (default): exactamente los mismos repositorios de siempre.
    const repositories = isApiMode()
      ? withApiPos(
          withApiLogisticsDispatch(
            withApiLogisticsPacking(
              withApiLogisticsPickingRead(
                withApiReceiving(
                  withApiPurchaseOrders(
                    withApiInventoryTransfers(
                      withApiInventoryStock(
                        withApiInventoryMovements(
                          withApiProductRelations(
                            withApiProducts(
                              withApiCatalogMasterData(
                                withApiStorePickupHandover(
                                  withApiLogisticsHistory(
                                    withApiSession(mockRepositories, eventBus),
                                  ),
                                ),
                                eventBus,
                              ),
                              eventBus,
                            ),
                            eventBus,
                          ),
                        ),
                        eventBus,
                      ),
                      eventBus,
                    ),
                    eventBus,
                  ),
                  eventBus,
                ),
              ),
            ),
          ),
          eventBus,
        )
      : mockRepositories;
    // Datos de referencia cacheados: se descartan en cuanto cambia su fuente (el TTL cubre el resto).
    const referenceCache = getReferenceDataCache(repositories);
    eventBus.subscribe("category.changed", () =>
      referenceCache.invalidatePrefix(referenceDataPrefixes.categories),
    );
    eventBus.subscribe("supplier.changed", () =>
      referenceCache.invalidatePrefix(referenceDataPrefixes.suppliers),
    );
    eventBus.subscribe("inventory.changed", (payload) => {
      if (payload.metadata?.entity !== "StorageLocation") return;
      if (payload.tenantId && payload.branchId) {
        referenceCache.invalidate(referenceDataKeys.locations(payload.tenantId, payload.branchId));
        return;
      }
      referenceCache.invalidatePrefix(referenceDataPrefixes.locations);
    });
    return {
      repositories,
      eventBus,
      resetMockData: () => {
        store.resetToSeeds();
        eventBus.emit("business-config.changed", { action: "reset" });
      },
    };
  }, []);

  return <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>;
}

export function useRepositories() {
  const context = useContext(RepositoryContext);
  if (!context) throw new Error("useRepositories must be used inside RepositoryProvider");
  return context.repositories;
}

export function useDataEventBus() {
  const context = useContext(RepositoryContext);
  if (!context) throw new Error("useDataEventBus must be used inside RepositoryProvider");
  return context.eventBus;
}

export function useResetMockData() {
  const context = useContext(RepositoryContext);
  if (!context) throw new Error("useResetMockData must be used inside RepositoryProvider");
  return context.resetMockData;
}
