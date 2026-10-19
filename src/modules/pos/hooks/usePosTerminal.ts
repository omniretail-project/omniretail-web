"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { calculateEffectivePrice, resolveQuantityPrice } from "@/core/pricing";
import {
  CashShiftStatus,
  DeliveryMethod,
  PaymentMethod,
  SaasCapabilityKey,
  TransportMode,
} from "@/core/enums";
import type { PosApiTrackingSelection, SaleConfirmationPaymentMethod } from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import type {
  CardTerminalOutcome,
  CheckoutBankAccountDto,
  CheckoutDto,
  CheckoutInvoiceDataDto,
  CheckoutPaymentMode,
} from "@/modules/pos/application/dto/CheckoutDto";
import type { PosProductDto } from "@/modules/pos/application/dto/PosProductDto";
import type { PosCashShiftDto } from "@/modules/pos/application/dto/PosCashShiftDto";
import type { PosSaleConfirmationDto } from "@/modules/pos/application/dto/PosSaleConfirmationDto";
import type {
  SaleTicketDto,
  SaleTicketItemDto,
  SaleTicketTrackingSummaryDto,
} from "@/modules/pos/application/dto/SaleTicketDto";
import {
  canonicalizePosTrackingSelections,
  normalizePosTrackingQuantity,
} from "@/modules/pos/application/posTrackingSelection";
import { ConfirmSaleService } from "@/modules/pos/application/services/ConfirmSaleService";
import {
  type PendingSaleConfirmation,
  PendingSaleConfirmationStore,
  canDiscardAfterRejection,
  isUncertainSaleFailure,
  pendingSaleScopeKey,
} from "@/modules/pos/application/services/pendingSaleConfirmation";
import { GetCheckoutBankAccountsService } from "@/modules/pos/application/services/GetCheckoutBankAccountsService";
import { GetPosProductsService } from "@/modules/pos/application/services/GetPosProductsService";
import { GetOpenCashShiftService } from "@/modules/pos/application/services/GetOpenCashShiftService";
import {
  calculateCheckoutAmounts,
  validateCheckout as validateCheckoutDto,
  type CheckoutValidationErrors,
} from "@/modules/pos/validation/checkout.validation";
import { validateTicketQuantity } from "@/modules/pos/validation/ticket.validation";
import { validateSaleTicketTraceability } from "@/modules/pos/application/validateSaleTicketTraceability";
import { cleanPosError } from "@/modules/pos/application/services/posServiceContext";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import { useEntitlement } from "@/shared/hooks/useEntitlement";
import { useActiveBranch } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";
import { getCachedPosProducts, invalidatePosProductsCache } from "./posProductsCache";

interface TicketState {
  items: SaleTicketItemDto[];
  error: string | null;
}

interface CheckoutState {
  open: boolean;
  value: CheckoutDto;
  errors: CheckoutValidationErrors;
  validated: boolean;
  readyToConfirm: boolean;
  hasOperationalBlock: boolean;
  message: string | null;
}

interface ConfirmationAttempt {
  confirmationId: string;
  orderIdempotencyKey?: string;
  contextKey: string;
}

interface PosTraceabilityTicketRequest {
  contextKey: string;
  product: PosProductDto;
  requestedQuantity: number;
  requiredBaseQuantity: number;
  initialSelections: PosApiTrackingSelection[];
}

type EditableCheckoutPatch = Partial<Omit<CheckoutDto, "cardTerminalResult">>;

export function usePosTerminal() {
  const repositories = useRepositories();
  const { currentBranch, loading: branchLoading } = useActiveBranch();
  const {
    sessionId,
    user,
    canAccessBranch,
    hasPermission,
    loading: sessionLoading,
    error: sessionError,
  } = useCurrentSession();
  const { hasCapability } = useEntitlement();
  const productService = useMemo(() => new GetPosProductsService(repositories), [repositories]);
  const confirmationService = useMemo(() => new ConfirmSaleService(repositories), [repositories]);
  const openCashShiftService = useMemo(
    () => new GetOpenCashShiftService(repositories),
    [repositories],
  );
  const bankAccountsService = useMemo(
    () => new GetCheckoutBankAccountsService(repositories),
    [repositories],
  );
  const [products, setProducts] = useState<PosProductDto[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ticketState, setTicketState] = useState<TicketState>({ items: [], error: null });
  const [traceabilityRequest, setTraceabilityRequest] =
    useState<PosTraceabilityTicketRequest | null>(null);
  const [checkoutState, setCheckoutState] = useState<CheckoutState>(() => createCheckoutState(0));
  const [bankAccounts, setBankAccounts] = useState<CheckoutBankAccountDto[]>([]);
  const [bankAccountsLoading, setBankAccountsLoading] = useState(true);
  const [bankAccountsError, setBankAccountsError] = useState<string | null>(null);
  const [allowedPosPaymentMethods, setAllowedPosPaymentMethods] = useState<
    SaleConfirmationPaymentMethod[]
  >([]);
  const [paymentMethodsLoading, setPaymentMethodsLoading] = useState(true);
  const [paymentMethodsError, setPaymentMethodsError] = useState<string | null>(null);
  const [cashShift, setCashShift] = useState<PosCashShiftDto | null>(null);
  const [cashShiftLoading, setCashShiftLoading] = useState(true);
  const [cashShiftError, setCashShiftError] = useState<string | null>(null);
  const [confirmationAttempt, setConfirmationAttempt] = useState<ConfirmationAttempt | null>(null);
  const [confirmationLoading, setConfirmationLoading] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [confirmationResult, setConfirmationResult] = useState<PosSaleConfirmationDto | null>(null);
  const confirmationLoadingRef = useRef(false);
  // Venta con respuesta incierta: sobrevive a ediciones del ticket y a recargas (sessionStorage).
  // Su alcance no incluye la sesion: tras volver a iniciar sesion la venta sigue sin resolverse.
  const pendingStore = useMemo(() => new PendingSaleConfirmationStore(), []);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingSaleConfirmation | null>(null);
  const pendingConfirmationRef = useRef<PendingSaleConfirmation | null>(null);
  const applyPendingConfirmation = useCallback((value: PendingSaleConfirmation | null) => {
    pendingConfirmationRef.current = value;
    setPendingConfirmation(value);
  }, []);
  const pendingScopeKey =
    user && currentBranch ? pendingSaleScopeKey(user.id, currentBranch.tenantId, currentBranch.id) : null;
  const productsRequestRef = useRef(0);
  const reloadScheduledRef = useRef(false);
  const bankAccountsRequestRef = useRef(0);
  const cashShiftRequestRef = useRef(0);
  const paymentMethodsRequestRef = useRef(0);
  const cardTerminalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardTerminalReferenceSequenceRef = useRef(482931);
  const readContextKey = `${sessionId ?? ""}:${user?.id ?? ""}:${currentBranch?.tenantId ?? ""}:${currentBranch?.id ?? ""}`;
  const currentReadContextRef = useRef(readContextKey);
  currentReadContextRef.current = readContextKey;
  const currentConfirmationContextKey =
    sessionId && user && currentBranch && cashShift
      ? `${sessionId}:${user.id}:${currentBranch.tenantId}:${currentBranch.id}:${cashShift.id}`
      : null;
  const currentConfirmationContextRef = useRef(currentConfirmationContextKey);
  const confirmationId =
    confirmationAttempt?.contextKey === currentConfirmationContextKey
      ? confirmationAttempt.confirmationId
      : null;

  // Al abrir o recargar la terminal se recupera la venta incierta de este usuario, sucursal y caja.
  useEffect(() => {
    if (!pendingScopeKey) return;
    let active = true;
    window.queueMicrotask(() => {
      if (active) applyPendingConfirmation(pendingStore.load(pendingScopeKey));
    });
    return () => {
      active = false;
    };
  }, [applyPendingConfirmation, pendingScopeKey, pendingStore]);

  const reload = useCallback(async () => {
    const requestId = ++productsRequestRef.current;
    const requestedContext = readContextKey;
    if (branchLoading || sessionLoading) return;

    if (!currentBranch || !user) {
      setProducts([]);
      setError(sessionError ?? "No hay una sesión o sucursal activa disponible.");
      setLoading(false);
      return;
    }

    if (user.tenantId !== currentBranch.tenantId || !canAccessBranch(currentBranch.id)) {
      setProducts([]);
      setError("No tienes acceso a la sucursal activa.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextProducts = await getCachedPosProducts(repositories, requestedContext, () =>
        productService.execute({
          tenantId: currentBranch.tenantId,
          branchId: currentBranch.id,
        }),
      );
      if (
        requestId !== productsRequestRef.current ||
        requestedContext !== currentReadContextRef.current
      ) {
        return;
      }
      setProducts(nextProducts);
    } catch {
      if (
        requestId !== productsRequestRef.current ||
        requestedContext !== currentReadContextRef.current
      ) {
        return;
      }
      setProducts([]);
      setError("No se pudieron cargar los productos disponibles para POS.");
    } finally {
      if (
        requestId === productsRequestRef.current &&
        requestedContext === currentReadContextRef.current
      ) {
        setLoading(false);
      }
    }
  }, [
    branchLoading,
    canAccessBranch,
    currentBranch,
    productService,
    readContextKey,
    repositories,
    sessionError,
    sessionLoading,
    user,
  ]);

  const reloadBankAccounts = useCallback(async () => {
    const requestId = ++bankAccountsRequestRef.current;
    const requestedContext = readContextKey;
    if (branchLoading || sessionLoading) return;

    if (
      !currentBranch ||
      !user ||
      user.tenantId !== currentBranch.tenantId ||
      !canAccessBranch(currentBranch.id)
    ) {
      setBankAccounts([]);
      setBankAccountsError(null);
      setBankAccountsLoading(false);
      return;
    }

    setBankAccountsLoading(true);
    setBankAccountsError(null);
    try {
      const accounts = await bankAccountsService.execute({
        branchId: currentBranch.id,
      });
      if (
        requestId !== bankAccountsRequestRef.current ||
        requestedContext !== currentReadContextRef.current
      ) {
        return;
      }
      setBankAccounts(accounts);
    } catch (error_) {
      if (
        requestId !== bankAccountsRequestRef.current ||
        requestedContext !== currentReadContextRef.current
      ) {
        return;
      }
      setBankAccounts([]);
      setBankAccountsError(toBankAccountsErrorMessage(error_));
    } finally {
      if (
        requestId === bankAccountsRequestRef.current &&
        requestedContext === currentReadContextRef.current
      ) {
        setBankAccountsLoading(false);
      }
    }
  }, [
    bankAccountsService,
    branchLoading,
    canAccessBranch,
    currentBranch,
    readContextKey,
    sessionLoading,
    user,
  ]);

  const reloadCashShift = useCallback(async () => {
    const requestId = ++cashShiftRequestRef.current;
    const requestedContext = readContextKey;
    if (branchLoading || sessionLoading) return;

    setCashShift(null);
    setCashShiftError(null);

    if (
      !currentBranch ||
      !user ||
      user.tenantId !== currentBranch.tenantId ||
      !canAccessBranch(currentBranch.id)
    ) {
      setCashShiftLoading(false);
      return;
    }

    setCashShiftLoading(true);
    try {
      const shift = await openCashShiftService.execute({
        tenantId: currentBranch.tenantId,
        actorUserId: user.id,
        branchId: currentBranch.id,
      });
      if (
        requestId !== cashShiftRequestRef.current ||
        requestedContext !== currentReadContextRef.current
      ) {
        return;
      }
      const isValidShift =
        shift?.status === CashShiftStatus.open &&
        shift.userId === user.id &&
        shift.branchId === currentBranch.id &&
        user.tenantId === currentBranch.tenantId;

      if (!shift) return;
      if (!isValidShift) {
        setCashShiftError("El turno encontrado no coincide con la sesión y sucursal actuales.");
        return;
      }

      setCashShift(shift);
    } catch {
      if (
        requestId !== cashShiftRequestRef.current ||
        requestedContext !== currentReadContextRef.current
      ) {
        return;
      }
      setCashShiftError("No se pudo consultar el turno de caja abierto.");
    } finally {
      if (
        requestId === cashShiftRequestRef.current &&
        requestedContext === currentReadContextRef.current
      ) {
        setCashShiftLoading(false);
      }
    }
  }, [
    branchLoading,
    canAccessBranch,
    currentBranch,
    openCashShiftService,
    readContextKey,
    sessionLoading,
    user,
  ]);

  const reloadPaymentMethods = useCallback(async () => {
    const requestId = ++paymentMethodsRequestRef.current;
    const requestedContext = readContextKey;
    if (branchLoading || sessionLoading) return;

    if (
      !currentBranch ||
      !user ||
      user.tenantId !== currentBranch.tenantId ||
      !canAccessBranch(currentBranch.id)
    ) {
      setAllowedPosPaymentMethods([]);
      setPaymentMethodsError(null);
      setPaymentMethodsLoading(false);
      return;
    }

    setPaymentMethodsLoading(true);
    setPaymentMethodsError(null);
    try {
      const capabilities = await repositories.businessConfig.getCapabilities(
        currentBranch.tenantId,
      );
      if (
        requestId !== paymentMethodsRequestRef.current ||
        requestedContext !== currentReadContextRef.current
      ) {
        return;
      }
      const allowedMethods = getAllowedPosPaymentMethods(capabilities?.allowedPosPaymentMethods);
      setAllowedPosPaymentMethods(allowedMethods);
      if (allowedMethods.length === 0) {
        setPaymentMethodsError("No hay métodos de pago habilitados para POS.");
      }
    } catch {
      if (
        requestId !== paymentMethodsRequestRef.current ||
        requestedContext !== currentReadContextRef.current
      ) {
        return;
      }
      setAllowedPosPaymentMethods([]);
      setPaymentMethodsError("No se pudo cargar la configuración de métodos de pago.");
    } finally {
      if (
        requestId === paymentMethodsRequestRef.current &&
        requestedContext === currentReadContextRef.current
      ) {
        setPaymentMethodsLoading(false);
      }
    }
  }, [
    branchLoading,
    canAccessBranch,
    currentBranch,
    repositories.businessConfig,
    readContextKey,
    sessionLoading,
    user,
  ]);

  useLayoutEffect(() => {
    window.queueMicrotask(() => {
      productsRequestRef.current += 1;
      bankAccountsRequestRef.current += 1;
      cashShiftRequestRef.current += 1;
      paymentMethodsRequestRef.current += 1;
      setTicketState({ items: [], error: null });
      setTraceabilityRequest(null);
      setCheckoutState(createCheckoutState(0));
      setConfirmationAttempt(null);
      setConfirmationError(null);
      setConfirmationResult(null);
    });
  }, [readContextKey]);

  useEffect(() => {
    currentConfirmationContextRef.current = currentConfirmationContextKey;
  }, [currentConfirmationContextKey]);

  useEffect(() => {
    let active = true;
    window.queueMicrotask(() => {
      if (!active) return;
      void reload();
      void reloadBankAccounts();
      void reloadCashShift();
      void reloadPaymentMethods();
    });

    return () => {
      active = false;
    };
  }, [reload, reloadBankAccounts, reloadCashShift, reloadPaymentMethods]);

  useEffect(
    () => () => {
      if (cardTerminalTimerRef.current) clearTimeout(cardTerminalTimerRef.current);
    },
    [],
  );

  // Una operacion emite varios eventos en el mismo tick (inventario, stock, producto): se agrupan
  // en una sola recarga del catalogo en vez de repetir la consulta completa por cada evento.
  const scheduleReload = useCallback(() => {
    if (reloadScheduledRef.current) return;
    reloadScheduledRef.current = true;
    window.queueMicrotask(() => {
      reloadScheduledRef.current = false;
      invalidatePosProductsCache(repositories, readContextKey);
      void reload();
    });
  }, [readContextKey, reload, repositories]);

  const schedulePhysicalInventoryReload = useCallback(() => {
    if (pendingConfirmationRef.current) {
      scheduleReload();
      return;
    }
    setTraceabilityRequest(null);
    setConfirmationAttempt(null);
    setConfirmationError(null);
    setConfirmationResult(null);
    setTicketState((current) => ({
      ...current,
      items: current.items.map(clearTicketItemTracking),
    }));
    setCheckoutState((current) => ({
      ...current,
      errors: {},
      validated: false,
      readyToConfirm: false,
      hasOperationalBlock: false,
      message: null,
    }));
    scheduleReload();
  }, [scheduleReload]);

  useDataEvent("product.changed", schedulePhysicalInventoryReload);
  useDataEvent("promotion.changed", scheduleReload);
  useDataEvent("inventory.changed", schedulePhysicalInventoryReload);
  useDataEvent("stock.changed", schedulePhysicalInventoryReload);
  useDataEvent("payment.changed", reloadBankAccounts);
  useDataEvent("cash-shift.changed", reloadCashShift);
  useDataEvent("business-config.changed", reloadPaymentMethods);

  const filteredProducts = useMemo(() => filterPosProducts(products, search), [products, search]);
  const availablePaymentModes = useMemo(
    () => getAvailableCheckoutPaymentModes(allowedPosPaymentMethods),
    [allowedPosPaymentMethods],
  );

  const invalidateConfirmationAttempt = useCallback(() => {
    setConfirmationAttempt(null);
    setConfirmationError(null);
    setConfirmationResult(null);
  }, []);

  const cancelCardTerminalProcessing = useCallback(() => {
    if (!cardTerminalTimerRef.current) return;
    clearTimeout(cardTerminalTimerRef.current);
    cardTerminalTimerRef.current = null;
  }, []);

  const invalidateCheckoutValidation = useCallback(() => {
    invalidateConfirmationAttempt();
    setCheckoutState((current) => ({
      ...current,
      errors: {},
      validated: false,
      readyToConfirm: false,
      hasOperationalBlock: false,
      message: null,
    }));
  }, [invalidateConfirmationAttempt]);

  const prepareTraceabilitySelection = useCallback(
    (product: PosProductDto, requestedQuantity: number) => {
      if (isEditBlockedByPendingSale(pendingConfirmationRef, setTicketState)) return;
      const validationError = validatePosTicketQuantity(product, requestedQuantity);
      if (validationError) {
        setTicketState((current) => ({ ...current, error: validationError }));
        return;
      }
      if (product.requiresUnsupportedTraceability || !product.requiresTraceabilitySelection) {
        setTicketState((current) => ({
          ...current,
          error: `${product.name} requiere un flujo de venta que esta terminal todavía no soporta.`,
        }));
        return;
      }

      try {
        const requiredBaseQuantity = normalizePosTrackingQuantity(
          requestedQuantity * product.saleUnitToBaseFactor,
        );
        if (product.requiresSerial && !Number.isInteger(requiredBaseQuantity)) {
          throw new Error("Los productos serializados requieren una cantidad base entera.");
        }
        setTicketState((current) => ({ ...current, error: null }));
        setTraceabilityRequest({
          contextKey: readContextKey,
          product,
          requestedQuantity,
          requiredBaseQuantity,
          initialSelections:
            ticketState.items.find((item) => item.productId === product.productId)
              ?.trackingSelections ?? [],
        });
      } catch (conversionError) {
        setTicketState((current) => ({
          ...current,
          error:
            conversionError instanceof Error
              ? conversionError.message
              : "No se pudo convertir la cantidad a unidades base.",
        }));
      }
    },
    [readContextKey, ticketState.items],
  );

  const addProduct = useCallback(
    (product: PosProductDto) => {
      if (isEditBlockedByPendingSale(pendingConfirmationRef, setTicketState)) return;
      invalidateCheckoutValidation();
      if (product.requiresUnsupportedTraceability) {
        setTicketState((current) => ({
          ...current,
          error: `${product.name} requiere un flujo de venta que esta terminal todavía no soporta.`,
        }));
        return;
      }
      setTicketState((current) => {
        const currentItem = current.items.find((item) => item.productId === product.productId);
        const nextQuantity = (currentItem?.quantity ?? 0) + 1;
        const validationError = validatePosTicketQuantity(product, nextQuantity);
        if (validationError) return { ...current, error: validationError };

        if (currentItem) {
          return {
            error: null,
            items: current.items.map((item) =>
              item.productId === product.productId
                ? createTicketItem(product, nextQuantity)
                : item,
            ),
          };
        }

        return {
          error: null,
          items: [...current.items, createTicketItem(product, 1)],
        };
      });
    },
    [invalidateCheckoutValidation],
  );

  const increaseQuantity = useCallback(
    (productId: string) => {
      if (isEditBlockedByPendingSale(pendingConfirmationRef, setTicketState)) return;
      invalidateCheckoutValidation();
      const item = ticketState.items.find((candidate) => candidate.productId === productId);
      const product = products.find((candidate) => candidate.productId === productId);
      if (item?.trackingSelections?.length && !product?.requiresTraceabilitySelection) {
        setTicketState((current) => ({
          ...current,
          error: "El producto trazable ya no está disponible; actualiza el catálogo antes de cambiar la cantidad.",
        }));
        return;
      }
      setTicketState((current) => {
        const item = current.items.find((candidate) => candidate.productId === productId);
        if (!item) return current;

        const requestedQuantity = item.quantity + 1;
        const validationError = validatePosTicketQuantity(product ?? item, requestedQuantity);
        if (validationError) return { ...current, error: validationError };

        return {
          error: null,
          items: current.items.map((candidate) =>
            candidate.productId === productId
              ? updateTicketItemQuantity(
                  candidate,
                  requestedQuantity,
                  products.find((product) => product.productId === productId),
                )
              : candidate,
          ),
        };
      });
    },
    [invalidateCheckoutValidation, products, ticketState.items],
  );

  const decreaseQuantity = useCallback(
    (productId: string) => {
      if (isEditBlockedByPendingSale(pendingConfirmationRef, setTicketState)) return;
      invalidateCheckoutValidation();
      const currentItem = ticketState.items.find((candidate) => candidate.productId === productId);
      const product = products.find((candidate) => candidate.productId === productId);
      if (
        currentItem?.trackingSelections?.length &&
        currentItem.quantity > 1 &&
        !product?.requiresTraceabilitySelection
      ) {
        setTicketState((current) => ({
          ...current,
          error: "El producto trazable ya no está disponible; actualiza el catálogo antes de cambiar la cantidad.",
        }));
        return;
      }
      setTicketState((current) => {
        const item = current.items.find((candidate) => candidate.productId === productId);
        if (!item) return current;
        if (item.quantity === 1) {
          return {
            items: current.items.filter((candidate) => candidate.productId !== productId),
            error: null,
          };
        }

        const requestedQuantity = item.quantity - 1;
        const validationError = validatePosTicketQuantity(product ?? item, requestedQuantity);
        if (validationError) return { ...current, error: validationError };

        return {
          error: null,
          items: current.items.map((candidate) =>
            candidate.productId === productId
              ? updateTicketItemQuantity(
                  candidate,
                  requestedQuantity,
                  products.find((product) => product.productId === productId),
                )
              : candidate,
          ),
        };
      });
    },
    [invalidateCheckoutValidation, products, ticketState.items],
  );

  const setQuantity = useCallback(
    (productId: string, requestedQuantity: number) => {
      if (isEditBlockedByPendingSale(pendingConfirmationRef, setTicketState)) return;
      invalidateCheckoutValidation();
      const item = ticketState.items.find((candidate) => candidate.productId === productId);
      const product = products.find((candidate) => candidate.productId === productId);
      if (
        item?.trackingSelections?.length &&
        requestedQuantity !== item.quantity &&
        !product?.requiresTraceabilitySelection
      ) {
        setTicketState((current) => ({
          ...current,
          error: "El producto trazable ya no está disponible; actualiza el catálogo antes de cambiar la cantidad.",
        }));
        return;
      }
      setTicketState((current) => {
        const item = current.items.find((candidate) => candidate.productId === productId);
        if (!item) return current;

        const validationError = validatePosTicketQuantity(product ?? item, requestedQuantity);
        if (validationError) return { ...current, error: validationError };

        return {
          error: null,
          items: current.items.map((candidate) =>
            candidate.productId === productId
              ? updateTicketItemQuantity(
                  candidate,
                  requestedQuantity,
                  products.find((product) => product.productId === productId),
                )
              : candidate,
          ),
        };
      });
    },
    [invalidateCheckoutValidation, products, ticketState.items],
  );

  const cancelTraceabilitySelection = useCallback(() => {
    setTraceabilityRequest(null);
  }, []);

  const confirmTraceabilitySelection = useCallback(
    (
      selections: PosApiTrackingSelection[],
      summary: SaleTicketTrackingSummaryDto[] = [],
    ) => {
      if (isEditBlockedByPendingSale(pendingConfirmationRef, setTicketState)) {
        setTraceabilityRequest(null);
        return;
      }
      const request = traceabilityRequest;
      if (!request || request.contextKey !== currentReadContextRef.current) {
        setTraceabilityRequest(null);
        return;
      }
      try {
        const canonical = validateTicketTrackingSelections(request, selections, ticketState.items);
        invalidateCheckoutValidation();
        setTicketState((current) => {
          const nextItem = createTicketItem(
            request.product,
            request.requestedQuantity,
            canonical,
            request.requiredBaseQuantity,
            summary,
          );
          const existingIndex = current.items.findIndex(
            (item) => item.productId === request.product.productId,
          );
          return {
            error: null,
            items:
              existingIndex < 0
                ? [...current.items, nextItem]
                : current.items.map((item, index) => (index === existingIndex ? nextItem : item)),
          };
        });
        setTraceabilityRequest(null);
      } catch (selectionError) {
        setTicketState((current) => ({
          ...current,
          error:
            selectionError instanceof Error
              ? selectionError.message
              : "La selección física no es válida.",
        }));
      }
    },
    [invalidateCheckoutValidation, ticketState.items, traceabilityRequest],
  );

  const removeItem = useCallback(
    (productId: string) => {
      if (isEditBlockedByPendingSale(pendingConfirmationRef, setTicketState)) return;
      invalidateCheckoutValidation();
      setTraceabilityRequest((current) =>
        current?.product.productId === productId ? null : current,
      );
      setTicketState((current) => ({
        items: current.items.filter((item) => item.productId !== productId),
        error: null,
      }));
    },
    [invalidateCheckoutValidation],
  );

  const clearTicket = useCallback(() => {
    if (isEditBlockedByPendingSale(pendingConfirmationRef, setTicketState)) return;
    cancelCardTerminalProcessing();
    invalidateConfirmationAttempt();
    setTraceabilityRequest(null);
    setTicketState({ items: [], error: null });
    setCheckoutState(createCheckoutState(0));
  }, [cancelCardTerminalProcessing, invalidateConfirmationAttempt]);

  const ticket = useMemo<SaleTicketDto>(
    () => calculateTicket(ticketState.items),
    [ticketState.items],
  );
  const hasCurrentBranchAccess = Boolean(
    !branchLoading &&
    !sessionLoading &&
    currentBranch &&
    user &&
    user.tenantId === currentBranch.tenantId &&
    canAccessBranch(currentBranch.id),
  );
  // UI action gating (feature/saas-entitlement-enforcement §7/§11): confirmar venta es la unica
  // operacion mutable de este hook -- Sales History vive en usePosSalesHistory (no tocado, sigue
  // sin gatear por capability). El backend (ConfirmSaleService) sigue siendo la autoridad final.
  const hasPosSalesPermission =
    hasPermission("pos.sales.create") && hasCapability(SaasCapabilityKey.pos);
  const hasOpenCashShift = Boolean(
    !cashShiftLoading &&
    !cashShiftError &&
    cashShift &&
    currentBranch &&
    user &&
    cashShift.status === CashShiftStatus.open &&
    cashShift.userId === user.id &&
    cashShift.branchId === currentBranch.id &&
    user.tenantId === currentBranch.tenantId &&
    hasCurrentBranchAccess,
  );
  const ticketBlockingError = useMemo(
    () =>
      ticket.items
        .map((item) => validateTicketQuantity(item, item.quantity))
        .find((validationError): validationError is string => Boolean(validationError)) ?? null,
    [ticket.items],
  );
  const canOpenCheckout =
    ticket.items.length > 0 && toCents(ticket.total) > 0 && !ticketBlockingError;

  const openCheckout = useCallback(() => {
    if (ticket.items.length === 0) {
      setTicketState((current) => ({ ...current, error: "Agrega productos antes de cobrar." }));
      return;
    }
    if (toCents(ticket.total) <= 0) {
      setTicketState((current) => ({
        ...current,
        error: "El total del ticket debe ser mayor que cero.",
      }));
      return;
    }
    if (ticketBlockingError) {
      setTicketState((current) => ({ ...current, error: ticketBlockingError }));
      return;
    }

    setTicketState((current) => ({ ...current, error: null }));
    if (!confirmationId) cancelCardTerminalProcessing();
    setCheckoutState((current) =>
      confirmationId
        ? { ...current, open: true }
        : {
            ...createCheckoutState(ticket.total, availablePaymentModes[0] ?? PaymentMethod.cash),
            open: true,
          },
    );
  }, [
    availablePaymentModes,
    cancelCardTerminalProcessing,
    confirmationId,
    ticket.items.length,
    ticket.total,
    ticketBlockingError,
  ]);

  const closeCheckout = useCallback(() => {
    setTraceabilityRequest(null);
    setCheckoutState((current) => ({ ...current, open: false }));
  }, []);

  const resetCheckout = useCallback(() => {
    if (isEditBlockedByPendingSale(pendingConfirmationRef, setTicketState)) return;
    cancelCardTerminalProcessing();
    invalidateConfirmationAttempt();
    setTraceabilityRequest(null);
    setTicketState((current) => ({
      ...current,
      items: current.items.map(clearTicketItemTracking),
    }));
    setCheckoutState((current) => ({
      ...createCheckoutState(ticket.total, availablePaymentModes[0] ?? PaymentMethod.cash),
      open: current.open,
    }));
  }, [
    availablePaymentModes,
    cancelCardTerminalProcessing,
    invalidateConfirmationAttempt,
    ticket.total,
  ]);

  const setDocumentType = useCallback(
    (documentType: CheckoutDto["documentType"]) => {
      if (isEditBlockedByPendingSale(pendingConfirmationRef, setTicketState)) return;
      invalidateConfirmationAttempt();
      setCheckoutState((current) => ({
        ...current,
        value: { ...current.value, documentType },
        errors: {},
        validated: false,
        readyToConfirm: false,
        hasOperationalBlock: false,
        message: null,
      }));
    },
    [invalidateConfirmationAttempt],
  );

  const setPaymentMode = useCallback(
    (paymentMode: CheckoutPaymentMode) => {
      if (isEditBlockedByPendingSale(pendingConfirmationRef, setTicketState)) return;
      if (!availablePaymentModes.includes(paymentMode)) return;
      cancelCardTerminalProcessing();
      invalidateConfirmationAttempt();
      setCheckoutState((current) => ({
        ...current,
        value: createPaymentModeValue(current.value, paymentMode, ticket.total),
        errors: {},
        validated: false,
        readyToConfirm: false,
        hasOperationalBlock: false,
        message: null,
      }));
    },
    [
      availablePaymentModes,
      cancelCardTerminalProcessing,
      invalidateConfirmationAttempt,
      ticket.total,
    ],
  );

  const updateCheckout = useCallback(
    (patch: EditableCheckoutPatch) => {
      if (isEditBlockedByPendingSale(pendingConfirmationRef, setTicketState)) return;
      if (patch.cardAmount !== undefined) cancelCardTerminalProcessing();
      if (
        patch.deliveryMethod !== undefined &&
        patch.deliveryMethod !== DeliveryMethod.immediate
      ) {
        setTraceabilityRequest(null);
        setTicketState((current) => ({
          ...current,
          items: current.items.map(clearTicketItemTracking),
        }));
      }
      invalidateConfirmationAttempt();
      setCheckoutState((current) => {
        const cardAmountChanged =
          patch.cardAmount !== undefined &&
          toCents(patch.cardAmount) !== toCents(current.value.cardAmount);
        const nextValue = {
          ...current.value,
          ...patch,
          cardTerminalResult: cardAmountChanged
            ? createIdleCardTerminalResult()
            : current.value.cardTerminalResult,
        };
        const amounts = calculateCheckoutAmounts(nextValue, ticket.total);
        return {
          ...current,
          value: { ...nextValue, changeAmount: amounts.changeAmount },
          errors: {},
          validated: false,
          readyToConfirm: false,
          hasOperationalBlock: false,
          message: null,
        };
      });
    },
    [cancelCardTerminalProcessing, invalidateConfirmationAttempt, ticket.total],
  );

  const processCardPayment = useCallback(
    (outcome: CardTerminalOutcome = "approved") => {
      if (isEditBlockedByPendingSale(pendingConfirmationRef, setTicketState)) return;
      cancelCardTerminalProcessing();
      invalidateConfirmationAttempt();

      const authorizedAmount = fromCents(toCents(checkoutState.value.cardAmount));
      if (toCents(authorizedAmount) <= 0) {
        setCheckoutState((current) => ({
          ...current,
          errors: {
            ...current.errors,
            cardAmount: "Ingresa un monto de tarjeta mayor que cero.",
          },
          validated: false,
          readyToConfirm: false,
          hasOperationalBlock: false,
          message: null,
        }));
        return;
      }

      setCheckoutState((current) => ({
        ...current,
        value: {
          ...current.value,
          cardTerminalResult: {
            status: "processing",
            authorizedAmount,
          },
        },
        errors: { ...current.errors, cardTerminal: undefined },
        validated: false,
        readyToConfirm: false,
        hasOperationalBlock: false,
        message: null,
      }));

      cardTerminalTimerRef.current = setTimeout(() => {
        cardTerminalTimerRef.current = null;
        const reference =
          outcome === "approved"
            ? createCardTerminalReference(cardTerminalReferenceSequenceRef.current++)
            : undefined;

        setCheckoutState((current) => {
          const terminalResult = current.value.cardTerminalResult;
          const isCurrentAttempt =
            terminalResult.status === "processing" &&
            toCents(terminalResult.authorizedAmount ?? 0) === toCents(authorizedAmount) &&
            toCents(current.value.cardAmount) === toCents(authorizedAmount);
          if (!isCurrentAttempt) return current;

          return {
            ...current,
            value: {
              ...current.value,
              cardTerminalResult: {
                status: outcome,
                authorizedAmount,
                reference,
              },
            },
            errors: {
              ...current.errors,
              cardTerminal: outcome === "rejected" ? "Pago rechazado por terminal." : undefined,
            },
            validated: false,
            readyToConfirm: false,
            hasOperationalBlock: false,
            message: null,
          };
        });
      }, CARD_TERMINAL_PROCESSING_DELAY_MS);
    },
    [cancelCardTerminalProcessing, checkoutState.value.cardAmount, invalidateConfirmationAttempt],
  );

  const updateInvoiceData = useCallback(
    (patch: Partial<CheckoutInvoiceDataDto>) => {
      if (isEditBlockedByPendingSale(pendingConfirmationRef, setTicketState)) return;
      invalidateConfirmationAttempt();
      setCheckoutState((current) => ({
        ...current,
        value: {
          ...current.value,
          invoiceData: { ...current.value.invoiceData, ...patch },
        },
        errors: {},
        validated: false,
        readyToConfirm: false,
        hasOperationalBlock: false,
        message: null,
      }));
    },
    [invalidateConfirmationAttempt],
  );

  const updateDeliveryAddress = useCallback(
    (patch: Partial<NonNullable<CheckoutDto["deliveryAddress"]>>) => {
      if (isEditBlockedByPendingSale(pendingConfirmationRef, setTicketState)) return;
      invalidateConfirmationAttempt();
      setCheckoutState((current) => ({
        ...current,
        value: {
          ...current.value,
          deliveryAddress: {
            recipientName: "",
            recipientPhone: "",
            line1: "",
            city: "",
            country: "Guatemala",
            ...current.value.deliveryAddress,
            ...patch,
          },
        },
        errors: {},
        validated: false,
        readyToConfirm: false,
        hasOperationalBlock: false,
        message: null,
      }));
    },
    [invalidateConfirmationAttempt],
  );

  const updateStorePickupContact = useCallback(
    (patch: Partial<NonNullable<CheckoutDto["storePickupContact"]>>) => {
      if (isEditBlockedByPendingSale(pendingConfirmationRef, setTicketState)) return;
      invalidateConfirmationAttempt();
      setCheckoutState((current) => ({
        ...current,
        value: {
          ...current.value,
          storePickupContact: {
            recipientName: "",
            recipientPhone: "",
            ...current.value.storePickupContact,
            ...patch,
          },
        },
        errors: {},
        validated: false,
        readyToConfirm: false,
        hasOperationalBlock: false,
        message: null,
      }));
    },
    [invalidateConfirmationAttempt],
  );

  const validateCheckout = useCallback(() => {
    setCheckoutState((current) => {
      const amounts = calculateCheckoutAmounts(current.value, ticket.total);
      const value = { ...current.value, changeAmount: amounts.changeAmount };
      const result = validateCheckoutDto(value, ticket.total);
      const hasAllowedPaymentMode = availablePaymentModes.includes(value.paymentMode);
      const immediateTraceabilityError =
        value.deliveryMethod === DeliveryMethod.immediate
          ? getImmediateTraceabilityError(ticket.items)
          : null;
      const hasDeferredTraceability =
        value.deliveryMethod !== DeliveryMethod.immediate &&
        ticket.items.some((item) => (item.trackingSelections?.length ?? 0) > 0);
      const hasOperationalBlock =
        ticket.hasUnsupportedTraceability ||
        Boolean(immediateTraceabilityError) ||
        hasDeferredTraceability ||
        !hasOpenCashShift ||
        !hasPosSalesPermission ||
        !hasCurrentBranchAccess ||
        paymentMethodsLoading ||
        Boolean(paymentMethodsError) ||
        !hasAllowedPaymentMode;

      return {
        ...current,
        value,
        errors: result.errors,
        validated: result.isValid,
        readyToConfirm: result.isValid && !hasOperationalBlock,
        hasOperationalBlock,
        message: result.isValid
          ? getCheckoutValidationMessage({
              cashShiftError,
              cashShiftLoading,
              hasCurrentBranchAccess,
              hasOpenCashShift,
              hasPosSalesPermission,
              hasUnsupportedTraceability: ticket.hasUnsupportedTraceability,
              immediateTraceabilityError,
              hasDeferredTraceability,
              hasAllowedPaymentMode,
              paymentMethodsError,
              paymentMethodsLoading,
            })
          : null,
      };
    });
  }, [
    availablePaymentModes,
    cashShiftError,
    cashShiftLoading,
    hasCurrentBranchAccess,
    hasOpenCashShift,
    hasPosSalesPermission,
    paymentMethodsError,
    paymentMethodsLoading,
    ticket.hasUnsupportedTraceability,
    ticket.items,
    ticket.total,
  ]);

  const checkoutAmounts = useMemo(
    () => calculateCheckoutAmounts(checkoutState.value, ticket.total),
    [checkoutState.value, ticket.total],
  );
  const checkoutImmediateTraceabilityError =
    checkoutState.value.deliveryMethod === DeliveryMethod.immediate
      ? getImmediateTraceabilityError(ticket.items)
      : null;
  const checkoutHasOperationalBlock =
    ticket.hasUnsupportedTraceability ||
    Boolean(checkoutImmediateTraceabilityError) ||
    (checkoutState.value.deliveryMethod !== DeliveryMethod.immediate &&
      ticket.items.some((item) => (item.trackingSelections?.length ?? 0) > 0)) ||
    !hasOpenCashShift ||
    !hasPosSalesPermission ||
    !hasCurrentBranchAccess ||
    paymentMethodsLoading ||
    Boolean(paymentMethodsError) ||
    !availablePaymentModes.includes(checkoutState.value.paymentMode);
  const checkoutReadyToConfirm =
    checkoutState.validated && checkoutState.readyToConfirm && !checkoutHasOperationalBlock;
  const checkoutMessage = checkoutState.validated
    ? getCheckoutValidationMessage({
        cashShiftError,
        cashShiftLoading,
        hasCurrentBranchAccess,
        hasOpenCashShift,
        hasPosSalesPermission,
        hasUnsupportedTraceability: ticket.hasUnsupportedTraceability,
        immediateTraceabilityError: checkoutImmediateTraceabilityError,
        hasDeferredTraceability:
          checkoutState.value.deliveryMethod !== DeliveryMethod.immediate &&
          ticket.items.some((item) => (item.trackingSelections?.length ?? 0) > 0),
        hasAllowedPaymentMode: availablePaymentModes.includes(checkoutState.value.paymentMode),
        paymentMethodsError,
        paymentMethodsLoading,
      })
    : checkoutState.message;

  const confirmSale = useCallback(async () => {
    const pending = pendingConfirmationRef.current;
    // Con una venta pendiente se reenvia ESA solicitud: el estado de pantalla ya no es la fuente.
    if (confirmationLoadingRef.current || (!pending && !checkoutReadyToConfirm)) return;
    if (!user || !currentBranch || !cashShift) {
      setConfirmationError("La sesión, sucursal o caja ya no está disponible.");
      return;
    }

    const confirmationContextKey = `${sessionId ?? ""}:${user.id}:${currentBranch.tenantId}:${currentBranch.id}:${cashShift.id}`;
    const scopeKey = pendingSaleScopeKey(user.id, currentBranch.tenantId, currentBranch.id);
    if (pending && pending.contextKey !== scopeKey) {
      setConfirmationError("La venta pendiente pertenece a otra sucursal.");
      return;
    }
    if (pending && pending.input.cashShiftId !== cashShift.id) {
      setConfirmationError(
        "La venta pendiente se envió en otro turno de caja y no se puede reenviar desde este. Revisa el Historial de ventas: si aparece, ya está registrada; si no, descártala y vuelve a cobrar.",
      );
      return;
    }
    const request = pending
      ? pending.input
      : {
          branchId: currentBranch.id,
          cashShiftId: cashShift.id,
          ticket,
          checkout: checkoutState.value,
        };
    const isDeferred = request.checkout.deliveryMethod !== DeliveryMethod.immediate;
    const attemptId = pending?.confirmationId ?? confirmationId ?? crypto.randomUUID();
    const orderIdempotencyKey =
      pending?.orderIdempotencyKey ??
      confirmationAttempt?.orderIdempotencyKey ??
      (isDeferred ? crypto.randomUUID() : undefined);
    if (!pending && !confirmationId) {
      setConfirmationAttempt({
        confirmationId: attemptId,
        orderIdempotencyKey,
        contextKey: confirmationContextKey,
      });
    }
    confirmationLoadingRef.current = true;
    setConfirmationLoading(true);
    setConfirmationError(null);
    setConfirmationResult(null);

    // Registro que quedo guardado justo antes del POST; si es `null`, la venta nunca se envio.
    let sent: PendingSaleConfirmation | null = null;
    try {
      const result = await confirmationService.execute({
        confirmationId: attemptId,
        ...request,
        orderIdempotencyKey,
        beforeSend: () => {
          // La solicitud se guarda ANTES de enviarla: si la pagina se cierra o recarga con el POST
          // en vuelo, la recuperacion existe. Si no se puede guardar, la venta no se envia.
          const base: PendingSaleConfirmation = pending ?? {
            version: 1,
            contextKey: scopeKey,
            confirmationId: attemptId,
            orderIdempotencyKey,
            input: request,
            createdAt: new Date().toISOString(),
            attempts: 0,
          };
          const record = { ...base, attempts: base.attempts + 1 };
          if (!pendingStore.save(record)) {
            throw new Error(
              "No se pudo guardar la venta para poder recuperarla si se pierde la respuesta, así que no se envió. Habilita el almacenamiento del navegador e inténtalo de nuevo.",
            );
          }
          sent = record;
          applyPendingConfirmation(record);
        },
      });

      // La venta quedo registrada: la verificacion pendiente se resuelve aunque el contexto cambiara.
      pendingStore.clear(scopeKey);
      if (pendingConfirmationRef.current?.contextKey === scopeKey) applyPendingConfirmation(null);
      if (currentConfirmationContextRef.current !== confirmationContextKey) return;

      setConfirmationResult(result);
      setConfirmationAttempt(null);
      setTicketState({ items: [], error: null });
      setCheckoutState(createCheckoutState(0));
    } catch (confirmationFailure) {
      const dispatched = sent as PendingSaleConfirmation | null;
      const sameContext = currentConfirmationContextRef.current === confirmationContextKey;
      if (dispatched && canDiscardAfterRejection(confirmationFailure, dispatched.attempts)) {
        // Primer envio rechazado por el servidor: no hay venta y se puede volver a editar.
        pendingStore.clear(scopeKey);
        if (pendingConfirmationRef.current?.contextKey === scopeKey) applyPendingConfirmation(null);
        if (!sameContext) return;
        setConfirmationAttempt(null);
      } else if (dispatched) {
        // Ya se envio y no hay prueba de que no se registrara: se conserva hasta verificarla.
        if (!sameContext) return;
        setConfirmationError(
          isUncertainSaleFailure(confirmationFailure)
            ? UNCERTAIN_SALE_MESSAGE
            : `${cleanPosError(confirmationFailure, "El servidor no aceptó la verificación.", "idempotent")} La venta sigue pendiente: verifícala de nuevo o revisa el Historial de ventas antes de descartarla.`,
        );
        return;
      }
      if (!sameContext) return;
      setConfirmationError(
        cleanPosError(
          confirmationFailure,
          "No se pudo confirmar la venta. Puedes reintentar sin perder el ticket.",
          "idempotent",
        ),
      );
    } finally {
      confirmationLoadingRef.current = false;
      setConfirmationLoading(false);
    }
  }, [
    applyPendingConfirmation,
    cashShift,
    checkoutReadyToConfirm,
    checkoutState.value,
    confirmationId,
    confirmationAttempt?.orderIdempotencyKey,
    confirmationService,
    currentBranch,
    pendingStore,
    sessionId,
    ticket,
    user,
  ]);

  /** Descarta la verificacion: solo tras revisar el historial, porque la venta pudo registrarse. */
  const discardPendingConfirmation = useCallback(() => {
    const pending = pendingConfirmationRef.current;
    if (!pending) return;
    pendingStore.clear(pending.contextKey);
    applyPendingConfirmation(null);
    setConfirmationAttempt(null);
    setConfirmationError(null);
  }, [applyPendingConfirmation, pendingStore]);

  return {
    pendingConfirmation: pendingConfirmation
      ? {
          confirmationId: pendingConfirmation.confirmationId,
          createdAt: pendingConfirmation.createdAt,
          total: pendingConfirmation.input.ticket.total,
          itemCount: pendingConfirmation.input.ticket.items.length,
        }
      : null,
    retryPendingConfirmation: confirmSale,
    discardPendingConfirmation,
    products,
    filteredProducts,
    search,
    setSearch,
    loading: branchLoading || sessionLoading || loading,
    error,
    reload,
    addProduct,
    increaseQuantity,
    decreaseQuantity,
    setQuantity,
    removeItem,
    clearTicket,
    traceabilityRequest,
    prepareTraceabilitySelection,
    cancelTraceabilitySelection,
    confirmTraceabilitySelection,
    ticketItems: ticket.items,
    subtotal: ticket.subtotal,
    discountTotal: ticket.discountTotal,
    total: ticket.total,
    hasUnsupportedTraceability: ticket.hasUnsupportedTraceability,
    ticketError: ticketState.error,
    canOpenCheckout,
    checkoutOpen: checkoutState.open,
    checkout: checkoutState.value,
    checkoutErrors: checkoutState.errors,
    checkoutValidated: checkoutState.validated,
    checkoutReadyToConfirm,
    checkoutHasOperationalBlock,
    checkoutMessage,
    checkoutAppliedAmount: checkoutAmounts.appliedAmount,
    checkoutDifferenceAmount: checkoutAmounts.differenceAmount,
    bankAccounts,
    bankAccountsLoading,
    bankAccountsError,
    availablePaymentModes,
    paymentMethodsLoading,
    paymentMethodsError,
    cashShift,
    cashShiftLoading,
    cashShiftError,
    hasOpenCashShift,
    hasPosSalesPermission,
    hasCurrentBranchAccess,
    currentBranchName: currentBranch?.name ?? null,
    confirmationId,
    confirmationLoading,
    confirmationError,
    confirmationResult,
    openCheckout,
    closeCheckout,
    resetCheckout,
    setDocumentType,
    setPaymentMode,
    updateCheckout,
    processCardPayment,
    updateInvoiceData,
    updateDeliveryAddress,
    updateStorePickupContact,
    validateCheckout,
    confirmSale,
  };
}

const PENDING_EDIT_MESSAGE =
  "Hay una venta pendiente de verificar. Usa «Verificar resultado» o descártala antes de modificar el ticket o el cobro.";

/** Mientras haya una venta incierta no se editan ticket ni cobro: solo se reenvia la solicitud original. */
function isEditBlockedByPendingSale(
  pendingRef: { current: PendingSaleConfirmation | null },
  setTicketState: (update: (current: TicketState) => TicketState) => void,
): boolean {
  if (!pendingRef.current) return false;
  setTicketState((current) => ({ ...current, error: PENDING_EDIT_MESSAGE }));
  return true;
}

const UNCERTAIN_SALE_MESSAGE =
  "No se pudo confirmar si la venta quedó registrada. No repitas el cobro: usa «Verificar resultado» para consultarlo con la misma solicitud.";

function filterPosProducts(products: PosProductDto[], search: string) {
  const query = search.trim().toLocaleLowerCase("es");
  if (!query) return products;

  return products.filter((product) =>
    [product.name, product.sku, product.barcode]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase("es").includes(query)),
  );
}

function createTicketItem(
  product: PosProductDto,
  quantity: number,
  trackingSelections: PosApiTrackingSelection[] = [],
  baseQuantity?: number,
  trackingSelectionSummary: SaleTicketTrackingSummaryDto[] = [],
): SaleTicketItemDto {
  const price = calculateEffectivePrice(
    resolveQuantityPrice({
      basePrice: product.basePrice,
      quantity,
      tiers: product.salesPriceTiers,
    }),
    product.promotion,
  );
  return {
    productId: product.productId,
    sku: product.sku,
    name: product.name,
    quantity,
    baseUnitPrice: price.basePrice,
    unitPrice: price.effectivePrice,
    discount: price.discountAmount,
    subtotal: fromCents(toCents(price.effectivePrice) * quantity),
    availableQuantity: product.availableQuantity,
    baseUnitId: product.baseUnitId,
    baseQuantity,
    saleUnitToBaseFactor: product.saleUnitToBaseFactor,
    saleUnitId: product.saleUnitId,
    saleUnitName: product.saleUnitName,
    tracksStock: product.tracksStock,
    requiresTraceabilitySelection: product.requiresTraceabilitySelection,
    requiresLot: product.requiresLot,
    requiresSerial: product.requiresSerial,
    requiresExpiration: product.requiresExpiration,
    requiresUnsupportedTraceability: product.requiresUnsupportedTraceability,
    trackingSelections: trackingSelections.length > 0 ? trackingSelections : undefined,
    trackingSelectionSummary:
      trackingSelectionSummary.length > 0 ? trackingSelectionSummary : undefined,
    isKit: product.productType === "kit",
  };
}

function clearTicketItemTracking(item: SaleTicketItemDto): SaleTicketItemDto {
  if (
    item.baseQuantity === undefined &&
    !item.trackingSelections?.length &&
    !item.trackingSelectionSummary?.length
  ) {
    return item;
  }
  return {
    ...item,
    baseQuantity: undefined,
    trackingSelections: undefined,
    trackingSelectionSummary: undefined,
  };
}

function validateTicketTrackingSelections(
  request: PosTraceabilityTicketRequest,
  selections: PosApiTrackingSelection[],
  currentItems: SaleTicketItemDto[],
): PosApiTrackingSelection[] {
  const canonical = canonicalizePosTrackingSelections(selections);
  if (canonical.length === 0) throw new Error("Debe seleccionar inventario físico.");
  if (canonical.some((selection) => selection.productId !== request.product.productId)) {
    throw new Error("La selección física no corresponde al producto solicitado.");
  }
  const selectedBaseQuantity = normalizePosTrackingQuantity(
    canonical.reduce((total, selection) => total + selection.quantity, 0),
  );
  if (selectedBaseQuantity !== request.requiredBaseQuantity) {
    throw new Error(
      `La selección debe cubrir exactamente ${request.requiredBaseQuantity} unidades base.`,
    );
  }

  const occupiedSerials = new Set(
    currentItems
      .filter((item) => item.productId !== request.product.productId)
      .flatMap((item) => item.trackingSelections ?? [])
      .flatMap((selection) => selection.serialNumbers ?? [])
      .map((serial) => serial.trim().toUpperCase()),
  );
  if (
    canonical.some((selection) =>
      (selection.serialNumbers ?? []).some((serial) =>
        occupiedSerials.has(serial.trim().toUpperCase()),
      ),
    )
  ) {
    throw new Error("Una serie seleccionada ya está asignada a otra línea del ticket.");
  }
  return canonical;
}

function updateTicketItemQuantity(
  item: SaleTicketItemDto,
  quantity: number,
  product?: PosProductDto,
): SaleTicketItemDto {
  if (quantity === item.quantity) return item;
  if (product) return createTicketItem(product, quantity);
  return {
    ...item,
    quantity,
    subtotal: fromCents(toCents(item.unitPrice) * quantity),
  };
}

function validatePosTicketQuantity(
  item: PosProductDto | SaleTicketItemDto,
  quantity: number,
): string | null {
  const quantityError = validateTicketQuantity(item, quantity);
  if (quantityError || !item.requiresTraceabilitySelection) return quantityError;

  try {
    const baseQuantity = normalizePosTrackingQuantity(
      quantity * (item.saleUnitToBaseFactor ?? Number.NaN),
    );
    if (item.requiresSerial && !Number.isInteger(baseQuantity)) {
      return "Los productos serializados requieren una cantidad base entera.";
    }
    return null;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "No se pudo convertir la cantidad a unidades base.";
  }
}

function calculateTicket(items: SaleTicketItemDto[]): SaleTicketDto {
  const subtotalCents = items.reduce(
    (total, item) => total + toCents(item.baseUnitPrice) * item.quantity,
    0,
  );
  const discountTotalCents = items.reduce(
    (total, item) => total + toCents(item.discount) * item.quantity,
    0,
  );
  const totalCents = items.reduce((total, item) => total + toCents(item.subtotal), 0);

  return {
    items,
    subtotal: fromCents(subtotalCents),
    discountTotal: fromCents(discountTotalCents),
    total: fromCents(totalCents),
    hasUnsupportedTraceability: items.some((item) => item.requiresUnsupportedTraceability),
  };
}

function getImmediateTraceabilityError(items: SaleTicketItemDto[]): string | null {
  try {
    validateSaleTicketTraceability(items);
    return null;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "La selección física del ticket debe revisarse.";
  }
}

function getCheckoutValidationMessage({
  cashShiftError,
  cashShiftLoading,
  hasCurrentBranchAccess,
  hasOpenCashShift,
  hasPosSalesPermission,
  hasUnsupportedTraceability,
  immediateTraceabilityError,
  hasDeferredTraceability,
  hasAllowedPaymentMode,
  paymentMethodsError,
  paymentMethodsLoading,
}: {
  cashShiftError: string | null;
  cashShiftLoading: boolean;
  hasCurrentBranchAccess: boolean;
  hasOpenCashShift: boolean;
  hasPosSalesPermission: boolean;
  hasUnsupportedTraceability: boolean;
  immediateTraceabilityError: string | null;
  hasDeferredTraceability: boolean;
  hasAllowedPaymentMode: boolean;
  paymentMethodsError: string | null;
  paymentMethodsLoading: boolean;
}) {
  if (!hasCurrentBranchAccess) {
    return "Cobro validado, pero no tienes acceso a la sucursal activa.";
  }
  if (!hasPosSalesPermission) {
    return "Cobro validado, pero no tienes permiso para crear ventas POS.";
  }
  if (paymentMethodsLoading) {
    return "Cobro validado, pero los métodos de pago todavía se están verificando.";
  }
  if (paymentMethodsError) {
    return `Cobro validado, pero ${paymentMethodsError.toLocaleLowerCase("es")}`;
  }
  if (!hasAllowedPaymentMode) {
    return "Cobro validado, pero el método de pago no está habilitado para POS.";
  }
  if (cashShiftLoading) {
    return "Cobro validado, pero el turno de caja todavía se está verificando.";
  }
  if (cashShiftError) return `Cobro validado, pero ${cashShiftError.toLocaleLowerCase("es")}`;
  if (!hasOpenCashShift) {
    return "Cobro validado, pero no hay un turno de caja abierto para esta sucursal.";
  }
  if (hasUnsupportedTraceability) {
    return "Cobro validado, pero la venta tiene productos con trazabilidad no soportada.";
  }
  if (immediateTraceabilityError) {
    return `Cobro validado, pero ${immediateTraceabilityError}`;
  }
  if (hasDeferredTraceability) {
    return "Cobro validado, pero los productos con selección física requieren entrega inmediata.";
  }
  return "Cobro validado. Pendiente de confirmación de venta.";
}

function createCheckoutState(
  total: number,
  paymentMode: CheckoutPaymentMode = PaymentMethod.cash,
): CheckoutState {
  return {
    open: false,
    value: createCheckoutValue(total, paymentMode),
    errors: {},
    validated: false,
    readyToConfirm: false,
    hasOperationalBlock: false,
    message: null,
  };
}

function createCheckoutValue(total: number, paymentMode: CheckoutPaymentMode): CheckoutDto {
  const totalAmount = fromCents(toCents(total));
  return {
    documentType: "ticket",
    invoiceData: {
      taxId: "",
      legalName: "",
      fiscalAddress: "",
    },
    paymentMode,
    cashAmount: paymentMode === PaymentMethod.cash ? totalAmount : 0,
    cashReceived: 0,
    changeAmount: 0,
    cardAmount: paymentMode === PaymentMethod.card ? totalAmount : 0,
    cardTerminalResult: createIdleCardTerminalResult(),
    transferAmount: paymentMode === PaymentMethod.transfer ? totalAmount : 0,
    bankAccountId: "",
    transferReference: "",
    transferExternallyVerified: false,
    deliveryMethod: "",
    transportMode: TransportMode.none,
    notificationContact: { emailMode: "send", email: "" },
  };
}

function getAllowedPosPaymentMethods(
  methods: PaymentMethod[] | undefined,
): SaleConfirmationPaymentMethod[] {
  const supportedMethods = new Set<SaleConfirmationPaymentMethod>();

  for (const method of methods ?? []) {
    switch (method) {
      case PaymentMethod.cash:
        supportedMethods.add(PaymentMethod.cash);
        break;
      case PaymentMethod.card:
        supportedMethods.add(PaymentMethod.card);
        break;
      case PaymentMethod.transfer:
        supportedMethods.add(PaymentMethod.transfer);
        break;
      case PaymentMethod.mixed:
        break;
      default:
        assertNeverPaymentMethod(method);
    }
  }

  return [...supportedMethods];
}

function assertNeverPaymentMethod(method: never): never {
  throw new Error(`Método de pago POS no soportado: ${String(method)}`);
}

function getAvailableCheckoutPaymentModes(
  methods: SaleConfirmationPaymentMethod[],
): CheckoutPaymentMode[] {
  const modes: CheckoutPaymentMode[] = [...methods];
  if (methods.length >= 2) modes.push("mixed");
  return modes;
}

function createPaymentModeValue(
  current: CheckoutDto,
  paymentMode: CheckoutPaymentMode,
  total: number,
): CheckoutDto {
  const totalAmount = fromCents(toCents(total));
  return {
    ...current,
    paymentMode,
    cashAmount: paymentMode === "cash" ? totalAmount : 0,
    cashReceived: 0,
    changeAmount: 0,
    cardAmount: paymentMode === "card" ? totalAmount : 0,
    cardTerminalResult: createIdleCardTerminalResult(),
    transferAmount: paymentMode === "transfer" ? totalAmount : 0,
    bankAccountId: "",
    transferReference: "",
    transferExternallyVerified: false,
  };
}

function toCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

function fromCents(value: number): number {
  return value / 100;
}

function createIdleCardTerminalResult(): CheckoutDto["cardTerminalResult"] {
  return { status: "idle" };
}

function createCardTerminalReference(sequence: number) {
  return `AUTH-${String(sequence).padStart(6, "0")}`;
}

const CARD_TERMINAL_PROCESSING_DELAY_MS = 650;

/**
 * Las cuentas bancarias se leen con un permiso administrativo (`admin.bank_accounts.manage`).
 * Un cajero sin ese permiso recibe 403: el cobro por transferencia queda fuera de su alcance en
 * esta entrega y se le indica con claridad, sin relajar el control del backend.
 */
function toBankAccountsErrorMessage(error: unknown) {
  if (error instanceof BackendRequestError && error.status === 403) {
    return "Tu rol no tiene acceso a las cuentas bancarias: el cobro por transferencia no está disponible. Usa efectivo o tarjeta.";
  }
  return "No se pudieron cargar las cuentas bancarias disponibles.";
}
