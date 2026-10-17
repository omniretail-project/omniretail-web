"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type { Address, CustomerPaymentMethod } from "@/core/entities";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import type { StorefrontCheckoutFormDto } from "@/modules/storefront/application/dto/StorefrontCheckoutDto";
import {
  shouldClearStaleCheckoutConfirmation,
  shouldShowCurrentCheckoutConfirmation,
} from "@/modules/storefront/application/services/storefrontCheckoutLifecycle";
import { useStorefrontCheckout } from "@/modules/storefront/hooks/useStorefrontCheckout";
import { useStorefrontCart } from "@/modules/storefront/providers/StorefrontCartProvider";
import { useStorefrontCheckoutConfirmation } from "@/modules/storefront/providers/StorefrontCheckoutConfirmationProvider";
import { municipalitiesByDepartment } from "@/modules/storefront/data/guatemalaLocations";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";
import { useStorefrontRoutes } from "@/modules/storefront/hooks/useStorefrontRoutes";
import {
  DELIVERY_ADDRESS_LIMITS,
  isValidDeliveryAddress,
  isValidDeliveryNotificationEmail,
  isValidRecipientName,
  sanitizeDeliveryAddress,
  sanitizeDeliveryNotificationEmail,
  sanitizeRecipientName,
} from "@/config/delivery-address-policy";
import { EMAIL_MAX_LENGTH, validateEmail } from "@/config/email-policy";
import {
  detectStorefrontCardBrand,
  getStorefrontCardSecurityCodeLength,
  validateStorefrontCardNumber,
} from "@/config/card-brands";
import {
  formatCardExpiration,
  formatCardNumber,
  getCardExpirationError,
  isCardNumberComplete,
} from "@/config/card-input-policy";
import { InlineAlert } from "@/shared/components/InlineAlert";
import {
  calculateStorefrontShipping,
  STOREFRONT_FREE_SHIPPING_THRESHOLD,
} from "@/config/storefront-shipping-policy";

const departments = Object.keys(municipalitiesByDepartment);

function formatGuatemalaPhone(value: string) {
  const digits = value.replace(/\D/g, "").replace(/^502/, "").slice(0, 8);
  return digits ? `+502 ${digits}` : "+502 ";
}

const initialForm: StorefrontCheckoutFormDto = {
  fullName: "",
  email: "",
  phone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  department: "",
  references: "",
  cardholderName: "",
  cardLastFour: "",
};
export function CheckoutPage() {
  const routes = useStorefrontRoutes();
  const { items, subtotal } = useStorefrontCart();
  const shippingTotal = calculateStorefrontShipping(subtotal);
  const orderTotal = subtotal + shippingTotal;
  const repositories = useRepositories();
  const { user } = useCurrentSession();
  const { tenantId, config, loading: configLoading } = usePublicTenant();
  const { submitting, error, result, submit } = useStorefrontCheckout();
  const { setResult } = useStorefrontCheckoutConfirmation();
  const [form, setForm] = useState(initialForm);
  const [step, setStep] = useState<1 | 2>(1);
  const [completedByCurrentCheckout, setCompletedByCurrentCheckout] = useState(false);
  const [savedCards, setSavedCards] = useState<CustomerPaymentMethod[]>([]);
  const [savedAddresses, setSavedAddresses] = useState<Address[]>([]);
  const [customerEmail, setCustomerEmail] = useState("");
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<string | "new">("new");
  const [selectedAddressId, setSelectedAddressId] = useState<string | "new">("new");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiration, setCardExpiration] = useState("");
  const [cardSecurityCode, setCardSecurityCode] = useState("");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const router = useRouter();
  useEffect(() => {
    let active = true;
    const loadCustomerCheckoutData = async () => {
      if (!user || !tenantId) {
        if (active) {
          setSavedCards([]);
          setSavedAddresses([]);
          setCustomerEmail("");
          setSelectedPaymentMethodId("new");
          setSelectedAddressId("new");
        }
        return;
      }
      const customer = await repositories.customers.getByUserId(user.id);
      if (!customer || customer.tenantId !== tenantId) return;
      const [cards, addresses] = await Promise.all([
        repositories.customerPaymentMethods.getByCustomer(tenantId, customer.id),
        repositories.addresses.getByCustomer(tenantId, customer.id),
      ]);
      if (!active) return;
      setSavedCards(cards);
      setSavedAddresses(addresses);
      setCustomerEmail(customer.email);
      const defaultCard = cards.find((card) => card.isDefault) ?? cards[0];
      if (defaultCard) {
        setSelectedPaymentMethodId(defaultCard.id);
        setForm((current) => ({
          ...current,
          cardholderName: defaultCard.cardholderName ?? "Titular registrado",
          cardLastFour: defaultCard.last4,
        }));
      }
      const defaultAddress = addresses.find((address) => address.isDefault) ?? addresses[0];
      if (defaultAddress) {
        setSelectedAddressId(defaultAddress.id);
        setForm((current) => ({
          ...current,
          fullName: defaultAddress.recipientName,
          email: customer.email,
          phone: customer.phone ? formatGuatemalaPhone(customer.phone) : "",
          addressLine1: defaultAddress.line1,
          addressLine2: defaultAddress.line2 ?? "",
          city: defaultAddress.city,
          department: defaultAddress.stateOrDepartment ?? "",
          references: defaultAddress.references ?? "",
        }));
      } else {
        setForm((current) => ({ ...current, email: customer.email }));
      }
    };
    void loadCustomerCheckoutData();
    return () => {
      active = false;
    };
  }, [repositories, tenantId, user]);

  const selectSavedCard = (card: CustomerPaymentMethod) => {
    setSelectedPaymentMethodId(card.id);
    setCardNumber("");
    setCardExpiration("");
    setCardSecurityCode("");
    setPaymentError(null);
    setForm({
      ...form,
      cardholderName: card.cardholderName ?? "Titular registrado",
      cardLastFour: card.last4,
    });
  };
  const selectSavedAddress = (address: Address) => {
    setSelectedAddressId(address.id);
    setForm((current) => ({
      ...current,
      fullName: address.recipientName,
      email: customerEmail || current.email,
      addressLine1: address.line1,
      addressLine2: address.line2 ?? "",
      city: address.city,
      department: address.stateOrDepartment ?? "",
      references: address.references ?? "",
    }));
  };
  const useAnotherAddress = () => {
    setSelectedAddressId("new");
    setForm((current) => ({
      ...current,
      fullName: "",
      phone: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      department: "",
      references: "",
      email: customerEmail || current.email,
    }));
  };
  useEffect(() => {
    if (shouldClearStaleCheckoutConfirmation(result, completedByCurrentCheckout)) setResult(null);
  }, [completedByCurrentCheckout, result, setResult]);
  useEffect(() => {
    if (shouldShowCurrentCheckoutConfirmation(result, completedByCurrentCheckout)) {
      router.replace(routes.confirmation(result?.trackingToken));
    }
  }, [completedByCurrentCheckout, result, router, routes]);
  if (shouldShowCurrentCheckoutConfirmation(result, completedByCurrentCheckout))
    return <main className="mx-auto max-w-3xl px-5 py-12">Preparando confirmación...</main>;
  if (!items.length)
    return (
      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-3xl font-black">Checkout</h1>
        <p className="mt-3 text-[var(--color-text-muted)]">Agrega productos antes de continuar.</p>
        <Link
          className="mt-5 inline-block rounded-xl bg-[var(--color-primary)] px-4 py-3 font-bold text-[var(--color-topbar)]"
          href={routes.catalog()}
        >
          Ver catálogo
        </Link>
      </main>
    );
  if (!configLoading && config?.accountRequired && !user)
    return (
      <main className="mx-auto max-w-3xl px-5 py-14">
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center shadow-sm">
          <h1 className="text-3xl font-black text-[var(--color-text)]">
            Inicia sesión para continuar
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-[var(--color-text-muted)]">
            Esta tienda requiere una cuenta para completar una compra. Inicia sesión o crea una
            cuenta para continuar al pago.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              className="rounded-xl bg-[var(--color-primary)] px-5 py-3 font-bold text-[var(--color-topbar)]"
              href={routes.login()}
            >
              Iniciar sesión
            </Link>
            <Link
              className="rounded-xl border border-[var(--color-border)] px-5 py-3 font-bold text-[var(--color-text)]"
              href={routes.register()}
            >
              Crear cuenta
            </Link>
          </div>
        </section>
      </main>
    );
  const hasValidRecipientName = Boolean(form.fullName.trim()) && isValidRecipientName(form.fullName);
  const hasValidEmail = !validateEmail(form.email) && isValidDeliveryNotificationEmail(form.email);
  const emailError = form.email && !hasValidEmail ? "Ingresa un correo electrónico válido." : undefined;
  const addressLine1Error =
    form.addressLine1 && !isValidDeliveryAddress(form.addressLine1, "line1")
      ? "Usa letras, números y , . # - /; sin signos repetidos."
      : undefined;
  const addressLine2Error =
    form.addressLine2 && !isValidDeliveryAddress(form.addressLine2, "line2")
      ? "Usa letras, números y , . # - /; sin signos repetidos."
      : undefined;
  const referencesError =
    form.references && !isValidDeliveryAddress(form.references, "references")
      ? "Usa letras, números y , . # - /; sin signos repetidos."
      : undefined;
  const ready = Boolean(
    hasValidRecipientName &&
    hasValidEmail &&
    form.phone.replace(/\D/g, "").replace(/^502/, "").length === 8 &&
    form.addressLine1 &&
    !addressLine1Error &&
    !addressLine2Error &&
    !referencesError &&
    form.city &&
    form.department,
  );
  const cardDigits = cardNumber.replace(/\D/g, "");
  const cardBrand = detectStorefrontCardBrand(cardDigits);
  const cardNumberError = validateStorefrontCardNumber(cardDigits);
  const cardNumberComplete = isCardNumberComplete(cardDigits);
  const expectedSecurityCodeLength = getStorefrontCardSecurityCodeLength(cardBrand);
  const cardExpirationError = cardExpiration ? getCardExpirationError(cardExpiration) : null;
  const paymentReady =
    selectedPaymentMethodId !== "new" ||
    (cardNumberComplete &&
      Boolean(form.cardholderName.trim()) &&
      isValidRecipientName(form.cardholderName) &&
      Boolean(cardExpiration) &&
      !cardExpirationError &&
      cardSecurityCode.length === expectedSecurityCodeLength);
  const canSubmitOrder = ready && paymentReady;
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (config?.accountRequired && !user) return;
    if (selectedPaymentMethodId === "new") {
      if (!cardDigits) {
        setPaymentError("Ingrese el número de tarjeta.");
        return;
      }
      if (!cardNumberComplete) {
        setPaymentError(
          cardNumberError ?? "Completa un número de tarjeta Visa, Mastercard o American Express.",
        );
        return;
      }
      if (!form.cardholderName.trim() || !isValidRecipientName(form.cardholderName)) {
        setPaymentError("El nombre del titular solo permite letras, espacios, guiones y apóstrofes.");
        return;
      }
      if (!cardExpiration || cardExpirationError) {
        setPaymentError(cardExpirationError ?? "Ingresa una fecha válida en formato MM/AA.");
        return;
      }
      if (cardSecurityCode.length !== expectedSecurityCodeLength) {
        setPaymentError(
          `Ingresa un código de seguridad de ${expectedSecurityCodeLength} dígitos.`,
        );
        return;
      }
    }
    setPaymentError(null);
    setCompletedByCurrentCheckout(true);
    const checkoutForm: StorefrontCheckoutFormDto = {
      ...form,
      cardLastFour:
        selectedPaymentMethodId === "new" ? cardDigits.slice(-4) : form.cardLastFour,
      phone: form.phone.replace(/\D/g, "").replace(/^502/, ""),
    };
    // El número completo, vencimiento y CVV solo viven en el estado de esta pantalla.
    // La orden recibe únicamente los últimos cuatro dígitos; nunca se persiste ni registra el resto.
    setCardNumber("");
    setCardExpiration("");
    setCardSecurityCode("");
    void submit(checkoutForm);
  };
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-5 sm:py-10">
      <Link className="text-sm font-bold text-[var(--color-title)]" href={routes.cart()}>
        ← Volver al carrito
      </Link>
      <div className="mx-auto mt-4 flex max-w-xl items-center gap-2 sm:gap-4">
        <Step active={step === 1} completed={step > 1} number="1" label="Envío y datos" />
        <span className={`h-0.5 flex-1 ${step > 1 ? "bg-[var(--color-success)]/60" : "bg-[var(--color-border)]"}`} />
        <Step active={step === 2} completed={false} number="2" label="Pago" />
        <span className="h-0.5 flex-1 bg-[var(--color-border)]" />
        <Step active={false} completed={false} number="3" label="Confirma" />
      </div>
      <div className="mt-8 grid gap-7 xl:grid-cols-[minmax(0,1fr)_27rem]">
        <form className="space-y-5" noValidate onSubmit={handleSubmit}>
          {step === 1 ? (
            <section className="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-black text-[var(--color-text)]">
                  Información de entrega
                </h2>
                <span className="text-sm text-[var(--color-text-muted)]">Paso 1 de 3</span>
              </div>
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                Elige una dirección guardada o indica una nueva dirección de entrega.
              </p>
              {savedAddresses.length > 0 ? (
                <div className="mt-5 space-y-3">
                  <p className="text-sm font-bold text-[var(--color-text)]">
                    Tus direcciones guardadas
                  </p>
                  {savedAddresses.map((address) => (
                    <button
                      className={`flex w-full min-w-0 flex-wrap items-start justify-between gap-3 rounded-xl border p-4 text-left transition ${selectedAddressId === address.id ? "border-[var(--color-primary-hover)] bg-[var(--color-primary)]/10" : "border-[var(--color-border)] hover:border-[var(--color-primary)]"}`}
                      key={address.id}
                      onClick={() => selectSavedAddress(address)}
                      type="button"
                    >
                      <span className="min-w-0 break-words">
                        <span className="block font-bold text-[var(--color-text)]">
                          {address.label}
                          {address.isDefault ? " · Predeterminada" : ""}
                        </span>
                        <span className="mt-1 block text-sm text-[var(--color-text-muted)]">
                          {address.recipientName} · {address.line1}, {address.city}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-bold text-[var(--color-title)]">
                        {selectedAddressId === address.id ? "Seleccionada" : "Seleccionar"}
                      </span>
                    </button>
                  ))}
                  <button
                    className="text-sm font-bold text-[var(--color-title)] underline"
                    onClick={useAnotherAddress}
                    type="button"
                  >
                    Usar otra dirección
                  </button>
                </div>
              ) : null}
              {selectedAddressId !== "new" ? (
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Teléfono de contacto"
                    type="tel"
                    inputMode="numeric"
                    maxLength={13}
                    placeholder="+502 00000000"
                    value={form.phone}
                    onChange={(value) => setForm({ ...form, phone: formatGuatemalaPhone(value) })}
                  />
                  <div className="rounded-xl border border-[var(--color-border)] bg-slate-50 px-4 py-3 text-sm text-[var(--color-text-muted)]">
                    Las notificaciones se enviarán a{" "}
                    <span className="font-bold text-[var(--color-text)]">{customerEmail}</span>.
                  </div>
                </div>
              ) : (
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Nombre completo"
                    error={
                      form.fullName && !hasValidRecipientName
                        ? "Usa solo letras, espacios, guiones y apóstrofes."
                        : undefined
                    }
                    maxLength={DELIVERY_ADDRESS_LIMITS.recipientName}
                    value={form.fullName}
                    onChange={(value) =>
                      setForm({ ...form, fullName: sanitizeRecipientName(value) })
                    }
                  />
                  <Field
                    label="Correo electrónico"
                    error={emailError}
                    maxLength={EMAIL_MAX_LENGTH}
                    type="email"
                    value={form.email}
                    onChange={(value) => setForm({ ...form, email: sanitizeDeliveryNotificationEmail(value) })}
                  />
                  <Field
                    label="Teléfono"
                    type="tel"
                    inputMode="numeric"
                    maxLength={13}
                    placeholder="+502 00000000"
                    value={form.phone}
                    onChange={(value) => setForm({ ...form, phone: formatGuatemalaPhone(value) })}
                  />
                  <Field
                    label="Dirección"
                    error={addressLine1Error}
                    maxLength={DELIVERY_ADDRESS_LIMITS.line1}
                    value={form.addressLine1}
                    onChange={(value) =>
                      setForm({ ...form, addressLine1: sanitizeDeliveryAddress(value, "line1") })
                    }
                  />
                  <Field
                    label="Complemento"
                    error={addressLine2Error}
                    maxLength={DELIVERY_ADDRESS_LIMITS.line2}
                    required={false}
                    value={form.addressLine2 ?? ""}
                    onChange={(value) =>
                      setForm({ ...form, addressLine2: sanitizeDeliveryAddress(value, "line2") })
                    }
                  />
                  <SelectField
                    label="Departamento"
                    options={departments}
                    placeholder="Selecciona un departamento"
                    value={form.department ?? ""}
                    onChange={(value) => setForm({ ...form, department: value, city: "" })}
                  />
                  <SelectField
                    disabled={!form.department}
                    label="Municipio"
                    options={form.department ? municipalitiesByDepartment[form.department] : []}
                    placeholder="Selecciona un municipio"
                    value={form.city}
                    onChange={(value) => setForm({ ...form, city: value })}
                  />
                  <Field
                    label="Referencias"
                    error={referencesError}
                    maxLength={DELIVERY_ADDRESS_LIMITS.references}
                    required={false}
                    value={form.references ?? ""}
                    onChange={(value) => setForm({ ...form, references: sanitizeDeliveryAddress(value, "references") })}
                  />
                </div>
              )}
              <button
                className="mt-6 w-full rounded-xl bg-[var(--color-primary)] px-5 py-3 font-bold text-[var(--color-topbar)] disabled:opacity-50 sm:w-auto"
                disabled={!ready}
                onClick={() => setStep(2)}
                type="button"
              >
                Continuar al pago
              </button>
            </section>
          ) : null}
          <section
            className={`min-w-0 rounded-xl border bg-[var(--color-surface)] p-4 shadow-sm sm:p-7 ${step === 2 ? "border-[var(--color-primary-hover)]" : "border-[var(--color-border)] opacity-70"}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-black text-[var(--color-text)]">Método de pago</h2>
              <span className="rounded-full bg-[var(--color-success)]/10 px-3 py-1 text-sm font-bold text-[var(--color-success)]">
                ♢ Pago 100% seguro
              </span>
            </div>
            {step === 2 ? (
              <div className="mt-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-slate-50 p-4 text-sm">
                  <div className="min-w-0 break-words">
                    <p className="font-bold text-[var(--color-text)]">
                      ▱ &nbsp; Entrega en tu dirección
                    </p>
                    <p className="mt-1 text-[var(--color-text-muted)]">
                      {form.addressLine1}, {form.city}, {form.department}
                    </p>
                  </div>
                  <button
                    className="shrink-0 font-bold text-[var(--color-title)]"
                    onClick={() => setStep(1)}
                    type="button"
                  >
                    Modificar
                  </button>
                </div>
                <div className="min-w-0 rounded-xl border-2 border-[var(--color-primary-hover)] bg-[var(--color-primary)]/10 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-4">
                    <p className="font-bold text-[var(--color-text)]">
                      ◉ &nbsp; ▣ &nbsp; Tarjeta de crédito o débito
                    </p>
                    <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text-muted)]">
                      {cardBrand ? `Marca: ${cardBrand === "American Express" ? "AmEx" : cardBrand}` : "Visa / Mastercard / AmEx"}
                    </span>
                  </div>
                  {savedCards.length > 0 ? (
                    <div className="mt-4 space-y-3">
                      <p className="text-sm font-bold text-[var(--color-text)]">
                        Tus tarjetas guardadas
                      </p>
                      {savedCards.map((card) => (
                        <button
                          className={`flex w-full min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-left transition ${selectedPaymentMethodId === card.id ? "border-[var(--color-primary-hover)] bg-white" : "border-[var(--color-border)] bg-white/70 hover:border-[var(--color-primary)]"}`}
                          key={card.id}
                          onClick={() => selectSavedCard(card)}
                          type="button"
                        >
                          <span className="min-w-0 break-words">
                            <span className="block font-bold text-[var(--color-text)]">
                              {card.brand} •••• {card.last4}
                            </span>
                            <span className="text-xs text-[var(--color-text-muted)]">
                              Vence {String(card.expirationMonth).padStart(2, "0")}/
                              {card.expirationYear}
                              {card.isDefault ? " · Predeterminada" : ""}
                            </span>
                          </span>
                          <span className="text-sm font-bold text-[var(--color-title)]">
                            {selectedPaymentMethodId === card.id ? "Seleccionada" : "Seleccionar"}
                          </span>
                        </button>
                      ))}
                      <button
                        className="text-sm font-bold text-[var(--color-title)] underline"
                        onClick={() => {
                          setSelectedPaymentMethodId("new");
                          setCardNumber("");
                          setCardExpiration("");
                          setCardSecurityCode("");
                          setPaymentError(null);
                          setForm({ ...form, cardholderName: "", cardLastFour: "" });
                        }}
                        type="button"
                      >
                        Usar otra tarjeta
                      </button>
                    </div>
                  ) : null}
                  {selectedPaymentMethodId === "new" ? (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <label className="grid gap-2 text-sm font-bold text-[var(--color-text)] sm:col-span-2">
                        Número de tarjeta
                        <input
                          autoComplete="cc-number"
                          className="rounded-xl border border-[var(--color-border)] bg-white px-3 py-3 font-normal text-[var(--color-text)]"
                          inputMode="numeric"
                          maxLength={23}
                          onChange={(event) => {
                            const nextNumber = formatCardNumber(event.target.value);
                            const nextBrand = detectStorefrontCardBrand(nextNumber.replace(/\D/g, ""));
                            setCardNumber(nextNumber);
                            if (getStorefrontCardSecurityCodeLength(nextBrand) === 3) {
                              setCardSecurityCode((current) => current.slice(0, 3));
                            }
                            setPaymentError(null);
                          }}
                          placeholder="4242 4242 4242 4242"
                          value={cardNumber}
                        />
                        {cardNumberError ? (
                          <span className="text-xs font-normal text-[var(--color-danger)]">
                            {cardNumberError}
                          </span>
                        ) : null}
                      </label>
                      <div className="sm:col-span-2">
                        <Field
                          label="Nombre del titular"
                          autoComplete="cc-name"
                          error={
                            form.cardholderName && !isValidRecipientName(form.cardholderName)
                              ? "Usa solo letras, espacios, guiones y apóstrofes."
                              : undefined
                          }
                          maxLength={DELIVERY_ADDRESS_LIMITS.recipientName}
                          value={form.cardholderName}
                          onChange={(value) => {
                            setForm({ ...form, cardholderName: sanitizeRecipientName(value) });
                            setPaymentError(null);
                          }}
                        />
                      </div>
                      <label className="grid gap-2 text-sm font-bold text-[var(--color-text)]">
                        Fecha de vencimiento
                        <input
                          autoComplete="cc-exp"
                          className="rounded-xl border border-[var(--color-border)] bg-white px-3 py-3 font-normal text-[var(--color-text)]"
                          inputMode="numeric"
                          maxLength={5}
                          onChange={(event) => {
                            setCardExpiration(formatCardExpiration(event.target.value));
                            setPaymentError(null);
                          }}
                          placeholder="MM/AA"
                          value={cardExpiration}
                        />
                        {cardExpirationError ? (
                          <span className="text-xs font-normal text-[var(--color-danger)]">
                            {cardExpirationError}
                          </span>
                        ) : null}
                      </label>
                      <label className="grid gap-2 text-sm font-bold text-[var(--color-text)]">
                        Código de seguridad (CVV)
                        <input
                          autoComplete="cc-csc"
                          className="rounded-xl border border-[var(--color-border)] bg-white px-3 py-3 font-normal text-[var(--color-text)]"
                          inputMode="numeric"
                          maxLength={expectedSecurityCodeLength}
                          onChange={(event) => {
                            setCardSecurityCode(event.target.value.replace(/\D/g, "").slice(0, 4));
                            setPaymentError(null);
                          }}
                          placeholder={expectedSecurityCodeLength === 4 ? "••••" : "•••"}
                          type="password"
                          value={cardSecurityCode}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>
          <section className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-border)] pt-5">
            <button
              className="text-sm font-bold text-[var(--color-title)]"
              onClick={() => setStep(1)}
              type="button"
            >
              ← Volver a datos de envío
            </button>
            {paymentError ?? error ? (
              <InlineAlert className="w-full" title={paymentError ?? error ?? ""} tone="danger" />
            ) : null}
            <button
              className="w-full rounded-xl bg-[var(--color-primary)] px-6 py-3 font-black text-[var(--color-topbar)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50 sm:w-auto"
              disabled={step !== 2 || submitting || !canSubmitOrder}
              type="submit"
            >
              {submitting ? "Procesando..." : `Realizar pedido (Q${orderTotal.toFixed(2)})`}
            </button>
          </section>
        </form>
        <aside className="h-fit min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm sm:p-6 xl:sticky xl:top-24">
          <p className="text-xl font-black text-[var(--color-text)]">Resumen del pedido</p>
          <div className="mt-4 space-y-3 border-t border-[var(--color-border)] pt-4">
            {items.map((item) => (
              <div key={item.productId} className="flex items-center justify-between gap-3 text-sm">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md border border-[var(--color-border)] bg-slate-50">
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt={item.imageAlt ?? item.name}
                        className="h-full w-full object-contain p-1"
                        src={item.imageUrl}
                      />
                    ) : (
                      <span className="text-xs text-[var(--color-text-muted)]">Producto</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-bold text-[var(--color-text)]">{item.name}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                      {item.quantity}× Q{item.unitPrice.toFixed(2)}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 font-bold text-[var(--color-title)]">
                  Q{(item.unitPrice * item.quantity).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-6 border-t border-[var(--color-border)] pt-5">
            <div className="flex items-center justify-between text-sm text-[var(--color-text-muted)]">
              <span>Subtotal</span>
              <span>Q{subtotal.toFixed(2)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm text-[var(--color-text-muted)]">
              <span>Envío</span>
              <span>{shippingTotal === 0 ? "Gratis" : `Q${shippingTotal.toFixed(2)}`}</span>
            </div>
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">
              {shippingTotal === 0
                ? "Tu compra tiene envío gratis."
                : `Envío gratis desde Q${STOREFRONT_FREE_SHIPPING_THRESHOLD.toFixed(2)}.`}
            </p>
            <div className="mt-4 flex items-end justify-between border-t border-[var(--color-border)] pt-4">
              <span className="text-lg font-black text-[var(--color-text)]">Total</span>
              <span className="text-3xl font-black text-[var(--color-title)]">
                Q{orderTotal.toFixed(2)}
              </span>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
function Step({
  active,
  completed,
  number,
  label,
}: {
  active: boolean;
  completed: boolean;
  number: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`grid h-7 w-7 place-items-center rounded-full text-xs font-black ${completed ? "bg-[var(--color-success)] text-white" : active ? "bg-[var(--color-primary)] text-[var(--color-topbar)] ring-4 ring-[var(--color-primary)]/20" : "bg-slate-200 text-[var(--color-text-muted)]"}`}
      >
        {number}
      </span>
      <span className={`hidden text-sm font-bold sm:block ${completed ? "text-[var(--color-success)]" : active ? "text-[var(--color-title)]" : "text-[var(--color-text-muted)]"}`}>{label}</span>
    </div>
  );
}
function Field({
  label,
  value,
  onChange,
  type = "text",
  required = true,
  autoComplete,
  inputMode,
  maxLength,
  error,
  pattern,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  inputMode?: "numeric";
  maxLength?: number;
  error?: string;
  pattern?: string;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-bold text-[var(--color-text)]">
      {label}
      <input
        className="rounded-xl border border-[var(--color-border)] bg-slate-50 px-3 py-3 font-normal outline-none focus:border-[var(--color-primary-hover)] focus:ring-4 focus:ring-[var(--color-primary)]/15"
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        pattern={pattern}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
      />
      {error ? <span className="text-xs font-normal text-[var(--color-danger)]">{error}</span> : null}
    </label>
  );
}

function SelectField({
  label,
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-2 text-sm font-bold text-[var(--color-text)]">
      {label}
      <select
        className="rounded-xl border border-[var(--color-border)] bg-slate-50 px-3 py-3 font-normal outline-none focus:border-[var(--color-primary-hover)] focus:ring-4 focus:ring-[var(--color-primary)]/15 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        required
        value={value}
      >
        <option disabled value="">
          {placeholder}
        </option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
