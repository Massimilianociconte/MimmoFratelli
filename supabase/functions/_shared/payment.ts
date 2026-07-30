/**
 * Shared payment primitives.
 *
 * Keep every Edge Function on the same Stripe SDK/API version and centralize
 * the trust boundary for redirect URLs, user input and error responses.
 */

import Stripe from "npm:stripe@20.4.1";

export const STRIPE_API_VERSION = "2026-02-25.clover" as const;
// Stripe requires at least 30 minutes. One extra minute absorbs small clock
// differences between the Edge runtime and Stripe.
export const CHECKOUT_TTL_SECONDS = 31 * 60;

const PRODUCTION_ORIGIN = "https://www.mimmofratelli.com";
const TRUSTED_SITE_ORIGINS = new Set([
  PRODUCTION_ORIGIN,
  "https://mimmofratelli.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5500",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5500",
]);

const stripeClients = new Map<string, Stripe>();

export function isStripeEventModeAllowed(
  livemode: boolean,
  allowTestMode = Deno.env.get("STRIPE_ALLOW_TEST_MODE") === "true",
): boolean {
  return livemode || allowTestMode;
}

export function getAsyncReservationMinutes(
  rawHours = Deno.env.get("STRIPE_ASYNC_RESERVATION_HOURS"),
): number {
  const parsedHours = Number(rawHours || 168);
  const boundedHours = Number.isInteger(parsedHours)
    ? Math.min(Math.max(parsedHours, 1), 336)
    : 168;
  return boundedHours * 60;
}

export function getStripe(livemode?: boolean): Stripe {
  const secretKey = livemode === true
    ? Deno.env.get("STRIPE_SECRET_KEY_LIVE") ||
      Deno.env.get("STRIPE_SECRET_KEY")
    : livemode === false
    ? Deno.env.get("STRIPE_SECRET_KEY_TEST") ||
      Deno.env.get("STRIPE_SECRET_KEY")
    : Deno.env.get("STRIPE_SECRET_KEY") ||
      Deno.env.get("STRIPE_SECRET_KEY_LIVE");
  if (!secretKey) {
    throw new Error(
      livemode === false
        ? "Stripe test secret key is not configured"
        : "Stripe secret key is not configured",
    );
  }

  const existingClient = stripeClients.get(secretKey);
  if (existingClient) return existingClient;

  const stripeClient = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 20_000,
  });

  stripeClients.set(secretKey, stripeClient);
  return stripeClient;
}

export function getTrustedSiteOrigin(request: Request): string {
  const requestOrigin = request.headers.get("origin") || "";
  return TRUSTED_SITE_ORIGINS.has(requestOrigin)
    ? requestOrigin
    : PRODUCTION_ORIGIN;
}

export function buildTrustedSiteUrl(
  request: Request,
  pathname: string,
  query: Record<string, string> = {},
): string {
  const url = new URL(pathname, `${getTrustedSiteOrigin(request)}/`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function getPaymentIntentId(
  session: Stripe.Checkout.Session,
): string | null {
  if (!session.payment_intent) return null;
  return typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent.id;
}

export function assertSettledEuroSession(
  session: Stripe.Checkout.Session,
): { paymentId: string; amountTotal: number } {
  if (session.currency?.toLowerCase() !== "eur") {
    throw new Error("Stripe session currency mismatch");
  }

  if (session.amount_total === null) {
    throw new Error("Stripe session is missing the amount total");
  }

  if (session.payment_status === "no_payment_required") {
    if (session.amount_total !== 0 || !session.id) {
      throw new Error("Invalid zero-value Stripe session");
    }
    return {
      paymentId: `checkout_session:${session.id}`,
      amountTotal: 0,
    };
  }

  if (session.payment_status !== "paid") {
    throw new PaymentInputError("Pagamento non completato", 409);
  }

  const paymentId = getPaymentIntentId(session);
  if (!paymentId) {
    throw new Error("Paid Stripe session is missing its PaymentIntent");
  }

  return { paymentId, amountTotal: session.amount_total };
}

export class PaymentInputError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PaymentInputError";
    this.status = status;
  }
}

export function normalizeText(
  value: unknown,
  field: string,
  maxLength: number,
  required = true,
): string {
  if (typeof value !== "string") {
    if (!required && (value === undefined || value === null)) return "";
    throw new PaymentInputError(`${field} non valido`);
  }

  const normalized = value.trim();
  if ((required && normalized.length === 0) || normalized.length > maxLength) {
    throw new PaymentInputError(`${field} non valido`);
  }
  return normalized;
}

export function normalizeEmail(value: unknown, field = "Email"): string {
  const email = normalizeText(value, field, 254).toLowerCase();
  const emailPattern =
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
  if (!emailPattern.test(email)) {
    throw new PaymentInputError(`${field} non valida`);
  }
  return email;
}

export interface ValidatedShippingAddress {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  postalCode: string;
  province: string;
  phone: string;
  country: "IT";
}

export function validateShippingAddress(
  value: unknown,
): ValidatedShippingAddress {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PaymentInputError("Indirizzo di spedizione non valido");
  }

  const input = value as Record<string, unknown>;
  const postalCode = normalizeText(input.postalCode, "CAP", 10);
  if (!/^\d{5}$/.test(postalCode)) {
    throw new PaymentInputError("CAP non valido");
  }

  const province = normalizeText(input.province, "Provincia", 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(province)) {
    throw new PaymentInputError("Provincia non valida");
  }

  const phone = normalizeText(input.phone, "Telefono", 30);
  if (!/^[+()\d\s./-]{6,30}$/.test(phone)) {
    throw new PaymentInputError("Telefono non valido");
  }

  return {
    firstName: normalizeText(input.firstName, "Nome", 80),
    lastName: normalizeText(input.lastName, "Cognome", 80),
    address: normalizeText(input.address, "Indirizzo", 180),
    city: normalizeText(input.city, "Città", 100),
    postalCode,
    province,
    phone,
    country: "IT",
  };
}

export function normalizeMoney(value: unknown, min: number, max: number): number {
  const amount = typeof value === "number" ? value : Number(value);
  if (
    !Number.isFinite(amount) ||
    amount < min ||
    amount > max ||
    Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6
  ) {
    throw new PaymentInputError("Importo non valido");
  }
  return amount;
}

export function escapeTelegramHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function publicPaymentError(error: unknown): {
  status: number;
  message: string;
} {
  if (error instanceof PaymentInputError) {
    return { status: error.status, message: error.message };
  }

  return {
    status: 500,
    message: "Il servizio pagamenti non è temporaneamente disponibile",
  };
}
