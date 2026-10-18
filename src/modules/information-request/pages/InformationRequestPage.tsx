"use client";

import Link from "next/link";
import { FormField } from "@/shared/components/FormField";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Input } from "@/shared/components/Input";
import {
  BUSINESS_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  FULL_NAME_MAX_LENGTH,
  INDUSTRY_OPTIONS,
  INTEREST_MODULE_OPTIONS,
  MESSAGE_MAX_LENGTH,
  PHONE_MAX_LENGTH,
  type IndustryCode,
} from "@/modules/information-request/application/dto/InformationRequestDto";
import { CaptchaWidget, getCaptchaSiteKey } from "@/modules/information-request/components/CaptchaWidget";
import { useInformationRequest } from "@/modules/information-request/hooks/useInformationRequest";

const inputClass =
  "h-11 rounded-md border-[var(--mkt-border)] bg-white focus:border-[var(--mkt-accent)] focus:ring-[var(--mkt-accent)]/25 aria-invalid:border-[var(--color-danger)] aria-invalid:ring-2 aria-invalid:ring-[var(--color-danger)]/20";
const controlClass =
  "w-full rounded-md border border-[var(--mkt-border)] bg-white px-3 text-sm text-[var(--mkt-text)] outline-none transition focus:border-[var(--mkt-accent)] focus:ring-2 focus:ring-[var(--mkt-accent)]/25 aria-invalid:border-[var(--color-danger)] aria-invalid:ring-2 aria-invalid:ring-[var(--color-danger)]/20";

function describedBy(id: string, error?: string) {
  return error ? `${id}-error` : undefined;
}

export function InformationRequestPage() {
  const captchaSiteKey = getCaptchaSiteKey();
  const request = useInformationRequest({ captchaRequired: Boolean(captchaSiteKey) });
  const { values, fieldErrors, status, message, requestId, isSubmitting } = request;

  if (status === "received" && requestId) {
    return (
      <div className="bg-[var(--mkt-bg)] px-5 py-[60px]">
        <section
          className="mx-auto max-w-[680px] rounded-[20px] border border-[var(--mkt-border-light)] bg-white p-8 text-center shadow-[0_20px_25px_-5px_rgba(47,103,231,.1)] sm:p-12"
          role="status"
        >
          <span
            aria-hidden="true"
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl font-bold text-[var(--mkt-success)]"
          >
            ✓
          </span>
          <h1 className="mt-6 text-3xl font-extrabold text-[var(--mkt-primary)]">
            Hemos recibido tu solicitud
          </h1>
          <p className="mt-3 text-[var(--mkt-muted)]">
            Gracias por tu interés en MARJYM. Nuestro equipo revisará la información y se pondrá en
            contacto contigo para brindarte una atención personalizada.
          </p>
          <p className="mt-6 text-sm text-[var(--mkt-muted)]">Tu número de solicitud es:</p>
          <p className="mt-1 break-all rounded-md border border-[var(--mkt-border-light)] bg-[var(--mkt-bg-alt)] p-3 font-mono text-sm font-semibold text-[var(--mkt-primary)]">
            {requestId}
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              className="rounded-md bg-[var(--mkt-accent)] px-6 py-3 font-semibold text-white hover:bg-[var(--mkt-accent-hover)]"
              href="/"
            >
              Volver al inicio
            </Link>
            <button
              className="rounded-md border border-[var(--mkt-border)] px-6 py-3 font-semibold text-[var(--mkt-primary)] hover:bg-[var(--mkt-bg-alt)]"
              onClick={request.reset}
              type="button"
            >
              Enviar otra solicitud
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="bg-[var(--mkt-bg)] px-4 py-[60px] sm:px-6">
      <section className="mx-auto max-w-[720px] rounded-[20px] border border-[var(--mkt-border-light)] bg-white p-6 shadow-[0_10px_15px_-3px_rgba(14,35,64,.08)] sm:p-8 lg:p-10">
        <header className="text-center">
          <span className="inline-flex rounded-full border border-[var(--mkt-border-light)] bg-[var(--mkt-accent-light)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[var(--mkt-accent)]">
            Atención personalizada
          </span>
          <h1 className="mt-4 text-3xl font-extrabold tracking-[-.02em] text-[var(--mkt-primary)]">
            Solicita información sobre MARJYM
          </h1>
          <p className="mt-3 text-[var(--mkt-muted)]">
            Cuéntanos sobre tu negocio. Nuestro equipo te contactará para entender tu operación y
            preparar una propuesta a tu medida.
          </p>
        </header>

        <form
          aria-busy={isSubmitting}
          className="mt-8 space-y-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void request.submit();
          }}
        >
          {status === "uncertain" && message ? (
            <InlineAlert title={message} tone="warning" />
          ) : null}
          {status === "failed" && message ? <InlineAlert title={message} tone="danger" /> : null}

          <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
            <FormField error={fieldErrors.fullName} id="info-full-name" label="Nombre completo *">
              <Input
                aria-describedby={describedBy("info-full-name", fieldErrors.fullName)}
                aria-invalid={Boolean(fieldErrors.fullName)}
                autoComplete="name"
                className={inputClass}
                id="info-full-name"
                maxLength={FULL_NAME_MAX_LENGTH}
                name="fullName"
                onChange={(event) => request.setField("fullName", event.target.value)}
                required
                value={values.fullName}
              />
            </FormField>
            <FormField error={fieldErrors.businessName} id="info-business-name" label="Nombre comercial *">
              <Input
                aria-describedby={describedBy("info-business-name", fieldErrors.businessName)}
                aria-invalid={Boolean(fieldErrors.businessName)}
                autoComplete="organization"
                className={inputClass}
                id="info-business-name"
                maxLength={BUSINESS_NAME_MAX_LENGTH}
                name="businessName"
                onChange={(event) => request.setField("businessName", event.target.value)}
                placeholder="Ej: Ferretería Los Altos"
                required
                value={values.businessName}
              />
            </FormField>
            <FormField error={fieldErrors.email} id="info-email" label="Correo electrónico *">
              <Input
                aria-describedby={describedBy("info-email", fieldErrors.email)}
                aria-invalid={Boolean(fieldErrors.email)}
                autoComplete="email"
                className={inputClass}
                id="info-email"
                maxLength={EMAIL_MAX_LENGTH}
                name="email"
                onChange={(event) => request.setField("email", event.target.value)}
                placeholder="contacto@empresa.com"
                required
                type="email"
                value={values.email}
              />
            </FormField>
            <FormField error={fieldErrors.phone} id="info-phone" label="Teléfono *">
              <Input
                aria-describedby={describedBy("info-phone", fieldErrors.phone)}
                aria-invalid={Boolean(fieldErrors.phone)}
                autoComplete="tel"
                className={inputClass}
                id="info-phone"
                inputMode="tel"
                maxLength={PHONE_MAX_LENGTH}
                name="phone"
                onChange={(event) => request.setField("phone", event.target.value)}
                placeholder="+502 1234 5678"
                required
                type="tel"
                value={values.phone}
              />
            </FormField>
          </div>

          <FormField error={fieldErrors.industry} id="info-industry" label="Rubro comercial *">
            <select
              aria-describedby={describedBy("info-industry", fieldErrors.industry)}
              aria-invalid={Boolean(fieldErrors.industry)}
              className={`${controlClass} h-11`}
              id="info-industry"
              name="industry"
              onChange={(event) =>
                request.setField("industry", event.target.value as IndustryCode | "")
              }
              required
              value={values.industry}
            >
              <option disabled value="">
                Selecciona un rubro
              </option>
              {INDUSTRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>

          <fieldset
            aria-describedby={describedBy("info-modules", fieldErrors.modules)}
            aria-invalid={Boolean(fieldErrors.modules)}
            aria-required="true"
          >
            <legend className="text-sm font-semibold text-[var(--mkt-text)]">
              Módulos de interés *
            </legend>
            <p className="mt-1 text-xs text-[var(--mkt-muted)]">
              Selecciona al menos uno. Puedes elegir varios.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {INTEREST_MODULE_OPTIONS.map((option) => (
                <label
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-[var(--mkt-border-light)] bg-[var(--mkt-bg-alt)] px-4 py-3 text-sm text-[var(--mkt-primary)] has-[:checked]:border-[var(--mkt-accent)] has-[:checked]:bg-[var(--mkt-accent-light)]"
                  key={option.value}
                >
                  <input
                    checked={values.modules.includes(option.value)}
                    className="h-4 w-4 rounded-sm accent-[var(--mkt-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mkt-accent)] focus-visible:ring-offset-2"
                    name="modules"
                    onChange={() => request.toggleModule(option.value)}
                    type="checkbox"
                    value={option.value}
                  />
                  {option.label}
                </label>
              ))}
            </div>
            {fieldErrors.modules ? (
              <p className="mt-2 text-xs font-medium text-[var(--color-danger)]" id="info-modules-error">
                {fieldErrors.modules}
              </p>
            ) : null}
          </fieldset>

          <FormField error={fieldErrors.message} id="info-message" label="Comentarios adicionales">
            <textarea
              aria-describedby={describedBy("info-message", fieldErrors.message)}
              aria-invalid={Boolean(fieldErrors.message)}
              className={`${controlClass} min-h-28 py-3`}
              id="info-message"
              maxLength={MESSAGE_MAX_LENGTH}
              name="message"
              onChange={(event) => request.setField("message", event.target.value)}
              placeholder="Ej: Necesitamos administrar dos sucursales."
              value={values.message}
            />
            <p className="text-right text-xs text-[var(--mkt-muted)]">
              {values.message.length}/{MESSAGE_MAX_LENGTH}
            </p>
          </FormField>

          {/* Honeypot: fuera de pantalla y fuera del orden de tabulacion para personas. */}
          <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label htmlFor="info-website">Sitio web</label>
            <input
              autoComplete="off"
              id="info-website"
              maxLength={200}
              name="website"
              onChange={(event) => request.setField("website", event.target.value)}
              tabIndex={-1}
              type="text"
              value={values.website}
            />
          </div>

          <div>
            <label className="flex items-start gap-3 text-sm text-[var(--mkt-text)]" htmlFor="info-consent">
              <input
                aria-describedby={describedBy("info-consent", fieldErrors.consentAccepted)}
                aria-invalid={Boolean(fieldErrors.consentAccepted)}
                checked={values.consentAccepted}
                className="mt-0.5 h-4 w-4 shrink-0 rounded-sm accent-[var(--mkt-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mkt-accent)] focus-visible:ring-offset-2"
                id="info-consent"
                name="consentAccepted"
                onChange={(event) => request.setField("consentAccepted", event.target.checked)}
                type="checkbox"
              />
              <span>
                Acepto que MARJYM use estos datos para responder mi solicitud y contactarme sobre
                el servicio. *
              </span>
            </label>
            {fieldErrors.consentAccepted ? (
              <p className="mt-2 text-xs font-medium text-[var(--color-danger)]" id="info-consent-error">
                {fieldErrors.consentAccepted}
              </p>
            ) : null}
          </div>

          {captchaSiteKey ? (
            <div>
              <CaptchaWidget
                onToken={(token) => request.setField("captchaToken", token)}
                resetKey={request.captchaNonce}
                siteKey={captchaSiteKey}
              />
              {fieldErrors.captchaToken ? (
                <p className="mt-2 text-xs font-medium text-[var(--color-danger)]" role="alert">
                  {fieldErrors.captchaToken}
                </p>
              ) : null}
            </div>
          ) : null}

          <p className="text-xs text-[var(--mkt-muted)]">
            Nunca te pediremos contraseñas ni datos de tarjeta en este formulario.
          </p>

          <button
            className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-[var(--mkt-accent)] px-6 py-3 font-semibold text-white shadow-[0_4px_6px_rgba(47,103,231,.25)] transition hover:bg-[var(--mkt-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting
              ? "Enviando solicitud..."
              : status === "uncertain"
                ? "Reintentar envío"
                : "Solicitar información"}
          </button>
        </form>
      </section>
    </div>
  );
}
