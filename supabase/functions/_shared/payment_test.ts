import {
  assertSettledEuroSession,
  buildTrustedSiteUrl,
  escapeTelegramHtml,
  getAsyncReservationMinutes,
  isStripeEventModeAllowed,
  normalizeMoney,
  PaymentInputError,
  validateShippingAddress,
} from "./payment.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertThrows(fn: () => unknown, message: string): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

Deno.test("redirect URLs use only an exact trusted origin", () => {
  const malicious = new Request("https://edge.example.test", {
    headers: { origin: "https://www.mimmofratelli.com.evil.example" },
  });
  const trusted = new Request("https://edge.example.test", {
    headers: { origin: "http://localhost:5173" },
  });

  assert(
    buildTrustedSiteUrl(malicious, "/checkout-success.html") ===
      "https://www.mimmofratelli.com/checkout-success.html",
    "lookalike origin must fall back to production",
  );
  assert(
    buildTrustedSiteUrl(trusted, "/checkout-success.html", { type: "order" }) ===
      "http://localhost:5173/checkout-success.html?type=order",
    "exact local origin should be preserved",
  );
});

Deno.test("money accepts cents only and enforces the configured range", () => {
  assert(normalizeMoney(10.25, 10, 500) === 10.25, "valid cents rejected");
  assertThrows(
    () => normalizeMoney(10.001, 10, 500),
    "sub-cent amount should fail",
  );
  assertThrows(() => normalizeMoney(501, 10, 500), "maximum should be enforced");
});

Deno.test("shipping input is normalized and Italy-only", () => {
  const shipping = validateShippingAddress({
    firstName: " Mario ",
    lastName: "Rossi",
    address: "Via Roma 1",
    city: "Milano",
    postalCode: "20100",
    province: "mi",
    phone: "+39 02 123456",
    country: "US",
  });

  assert(shipping.firstName === "Mario", "first name was not trimmed");
  assert(shipping.province === "MI", "province was not normalized");
  assert(shipping.country === "IT", "client-controlled country was trusted");
  assertThrows(
    () => validateShippingAddress({ ...shipping, postalCode: "2010" }),
    "invalid Italian postal code should fail",
  );
});

Deno.test("Telegram HTML is escaped", () => {
  assert(
    escapeTelegramHtml('<b title="x&y">') ===
      "&lt;b title=&quot;x&amp;y&quot;&gt;",
    "Telegram markup injection was not escaped",
  );
});

Deno.test("settled sessions require paid funds or a genuine zero total", () => {
  const paid = assertSettledEuroSession({
    id: "cs_test_paid",
    currency: "eur",
    amount_total: 1290,
    payment_status: "paid",
    payment_intent: "pi_test",
  } as never);
  assert(paid.paymentId === "pi_test", "paid PaymentIntent was not preserved");

  const zero = assertSettledEuroSession({
    id: "cs_test_zero",
    currency: "eur",
    amount_total: 0,
    payment_status: "no_payment_required",
    payment_intent: null,
  } as never);
  assert(
    zero.paymentId === "checkout_session:cs_test_zero",
    "zero-value session did not receive a stable internal payment ID",
  );

  assertThrows(
    () =>
      assertSettledEuroSession({
        id: "cs_test_unpaid",
        currency: "eur",
        amount_total: 1290,
        payment_status: "unpaid",
        payment_intent: null,
      } as never),
    "unpaid session should never settle",
  );
  assertThrows(
    () =>
      assertSettledEuroSession({
        id: "cs_test_invalid_zero",
        currency: "eur",
        amount_total: 1,
        payment_status: "no_payment_required",
        payment_intent: null,
      } as never),
    "non-zero no-payment session should never settle",
  );
});

Deno.test("public input errors retain their intended status", () => {
  const error = new PaymentInputError("Conflitto", 409);
  assert(error.status === 409, "input error status was lost");
});

Deno.test("test-mode Stripe events require an explicit environment opt-in", () => {
  assert(
    isStripeEventModeAllowed(true, false),
    "live events must remain enabled",
  );
  assert(
    !isStripeEventModeAllowed(false, false),
    "test events must be denied by default",
  );
  assert(
    isStripeEventModeAllowed(false, true),
    "isolated staging must be able to opt in",
  );
});

Deno.test("async payment reservations use a bounded whole-hour window", () => {
  assert(
    getAsyncReservationMinutes(undefined) === 7 * 24 * 60,
    "default async reservation must be seven days",
  );
  assert(
    getAsyncReservationMinutes("24") === 24 * 60,
    "configured whole hours were not preserved",
  );
  assert(
    getAsyncReservationMinutes("999") === 14 * 24 * 60,
    "async reservation maximum was not enforced",
  );
  assert(
    getAsyncReservationMinutes("1.5") === 7 * 24 * 60,
    "fractional hours must fall back to the safe default",
  );
});
