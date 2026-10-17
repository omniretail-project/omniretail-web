/**
 * Centralized session policy per account kind.
 *
 * Source: Arquitectura_Frontend_SaaS.pdf — section 4.13
 * ("Sesiones, Recordarme y reautenticación").
 *
 * This is the canonical source for session duration values. `sessionPolicy`
 * at the bottom (consumed today by MockAuthRepository) derives its values
 * from here instead of repeating them.
 */

export type AccountKind = "customer" | "employee";

export const SESSION_POLICY = {
  customer: {
    allowRememberMe: true,
    withoutRememberMe: {
      inactivityExpirationMinutes: 120, // 2 hours
    },
    withRememberMe: {
      persistentDurationDays: 30,
      requiresReauthForSensitiveActions: true,
    },
  },
  employee: {
    allowRememberMe: false, // employees never get "Recordarme", per 4.13
    inactivityExpirationMinutes: 30,
    maxShiftDurationHours: 8,
  },
} as const;

/**
 * Actions that always require re-authentication regardless of an
 * otherwise-valid session (section 4.13). This list will grow as later
 * modules (password change, MFA, etc.) are implemented.
 */
export const REAUTH_REQUIRED_ACTIONS = ["change_password", "change_role_or_permissions"] as const;

export type ReauthRequiredAction = (typeof REAUTH_REQUIRED_ACTIONS)[number];

/**
 * Legacy flat policy, consumed today by MockAuthRepository.login(), which
 * does not yet distinguish customer vs. employee sessions (that split is
 * planned for a later PR, once login differentiates account kinds). Both
 * values below derive from SESSION_POLICY so there is a single canonical
 * source; the resulting numbers are unchanged (8h / 30 days), so this does
 * not alter current login behavior.
 */
export const sessionPolicy = {
  normalSessionHours: SESSION_POLICY.employee.maxShiftDurationHours,
  rememberMeDays: SESSION_POLICY.customer.withRememberMe.persistentDurationDays,
} as const;
