/**
 * Shared Email Module (Resend)
 * Mimmo Fratelli E-commerce Platform
 *
 * Invio email transazionali: conferma ordine, spedizione, consegna, gift card.
 * Usato da: stripe-webhook, complete-order-purchase, complete-giftcard-purchase,
 * send-order-email, send-giftcard-email.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = "Mimmo Fratelli <noreply@mimmofratelli.com>";
const SITE_URL = "https://www.mimmofratelli.com";
const BRAND_COLOR = "#4a7c59";

export interface OrderEmailData {
  order_number?: string;
  id?: string;
  total?: number | string;
  subtotal?: number | string;
  discount?: number | string;
  shipping_cost?: number | string;
  tracking_number?: string | null;
  tracking_url?: string | null;
  courier?: string | null;
  shipping_address?: Record<string, string> | null;
  order_items?: OrderEmailItem[];
}

export interface OrderEmailItem {
  product_name?: string;
  quantity?: number;
  product_price?: number | string;
  weight_grams?: number | null;
}

export interface GiftCardEmailData {
  id?: string;
  code: string;
  amount: number;
  message?: string | null;
  sender_name?: string | null;
  recipient_name?: string | null;
  recipient_email: string;
  template?: string | null;
  expires_at?: string | null;
  stripe_session_id?: string | null;
}

/** Escape HTML per prevenire injection nei template email */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatEuro(value: number | string | undefined): string {
  return `€${Number(value || 0).toFixed(2)}`;
}

function formatWeight(grams: number): string {
  return grams >= 1000
    ? `${(grams / 1000).toFixed(grams % 1000 === 0 ? 0 : 2)} Kg`
    : `${grams} g`;
}

function orderRef(order: OrderEmailData): string {
  return escapeHtml(order.order_number || (order.id || "").slice(0, 8));
}

function firstName(order: OrderEmailData): string {
  return escapeHtml(order.shipping_address?.firstName || "");
}

function itemsTable(items: OrderEmailItem[] | undefined): string {
  if (!items || items.length === 0) return "";
  const rows = items.map((item) => {
    let name = escapeHtml(item.product_name || "Prodotto");
    if (item.weight_grams) name += ` (${formatWeight(Number(item.weight_grams))})`;
    const lineTotal = Number(item.product_price || 0) * Number(item.quantity || 1);
    return `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;">${name} × ${Number(item.quantity || 1)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${formatEuro(lineTotal)}</td>
    </tr>`;
  }).join("");
  return `<table style="width:100%;border-collapse:collapse;margin:16px 0;">${rows}</table>`;
}

function emailShell(content: string): string {
  return `<!DOCTYPE html>
<html lang="it">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f2;font-family:Georgia,'Times New Roman',serif;color:#333;">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;">
    <div style="text-align:center;padding:16px 0;">
      <span style="font-size:24px;letter-spacing:2px;color:${BRAND_COLOR};font-weight:bold;">Mimmo Fratelli</span>
    </div>
    <div style="background:#ffffff;border-radius:12px;padding:32px 28px;">
      ${content}
    </div>
    <div style="text-align:center;padding:20px;color:#888;font-size:12px;">
      <p style="margin:4px 0;"><a href="${SITE_URL}" style="color:${BRAND_COLOR};">www.mimmofratelli.com</a></p>
      <p style="margin:4px 0;">© ${new Date().getFullYear()} Mimmo Fratelli. Tutti i diritti riservati.</p>
    </div>
  </div>
</body>
</html>`;
}

function normalizeIdempotencyKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_./-]/g, "_").slice(0, 256);
}

/** Invio raw via Resend. Ritorna true se accettata. */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  idempotencyKey?: string,
): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY non configurata: email transazionale non inviata");
    return false;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        ...(idempotencyKey
          ? { "Idempotency-Key": normalizeIdempotencyKey(idempotencyKey) }
          : {}),
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    });

    if (!response.ok) {
      // Provider bodies can echo recipient details or validation input.
      console.error("Resend request failed with status", response.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      "Email request failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return false;
  }
}

/** Email di conferma ordine (status: confirmed/processing) */
export async function sendOrderConfirmationEmail(to: string, order: OrderEmailData): Promise<boolean> {
  const content = `
    <h1 style="font-size:22px;margin:0 0 16px;">Grazie per il tuo ordine!</h1>
    <p>Ciao ${firstName(order)},</p>
    <p>Il tuo ordine <strong>#${orderRef(order)}</strong> è stato confermato e sarà presto elaborato.</p>
    ${itemsTable(order.order_items)}
    <table style="width:100%;border-collapse:collapse;">
      ${Number(order.discount || 0) > 0 ? `<tr><td style="padding:4px 0;color:#666;">Sconto</td><td style="text-align:right;color:#666;">-${formatEuro(order.discount)}</td></tr>` : ""}
      ${Number(order.shipping_cost || 0) > 0 ? `<tr><td style="padding:4px 0;color:#666;">Spedizione</td><td style="text-align:right;color:#666;">${formatEuro(order.shipping_cost)}</td></tr>` : ""}
      <tr><td style="padding:8px 0;font-size:18px;"><strong>Totale</strong></td><td style="text-align:right;font-size:18px;"><strong>${formatEuro(order.total)}</strong></td></tr>
    </table>
    <p>Ti invieremo un'email quando il tuo ordine sarà spedito.</p>
    <p style="margin-top:24px;"><a href="${SITE_URL}/orders.html" style="background:${BRAND_COLOR};color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;">Vedi i tuoi ordini</a></p>`;
  return sendEmail(
    to,
    `Ordine confermato #${order.order_number || ""} - Mimmo Fratelli`,
    emailShell(content),
    `order-confirmed/${order.id || order.order_number || "unknown"}`,
  );
}

/** Email di ordine spedito (con tracking se disponibile) */
export async function sendOrderShippedEmail(to: string, order: OrderEmailData): Promise<boolean> {
  const trackingBlock = order.tracking_number ? `
    <div style="background:#f8f9fa;border-radius:8px;padding:16px;margin:16px 0;">
      ${order.courier ? `<p style="margin:4px 0;"><strong>Corriere:</strong> ${escapeHtml(String(order.courier).toUpperCase())}</p>` : ""}
      <p style="margin:4px 0;"><strong>Numero tracking:</strong> ${escapeHtml(order.tracking_number)}</p>
      ${order.tracking_url ? `<p style="margin:12px 0 4px;"><a href="${escapeHtml(order.tracking_url)}" style="background:${BRAND_COLOR};color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">Segui la spedizione</a></p>` : ""}
    </div>` : "";
  const content = `
    <h1 style="font-size:22px;margin:0 0 16px;">Il tuo ordine è in viaggio! 🚚</h1>
    <p>Ciao ${firstName(order)},</p>
    <p>Il tuo ordine <strong>#${orderRef(order)}</strong> è stato spedito.</p>
    ${trackingBlock}
    <p>Grazie per aver scelto Mimmo Fratelli!</p>`;
  return sendEmail(
    to,
    `Ordine spedito #${order.order_number || ""} - Mimmo Fratelli`,
    emailShell(content),
    `order-shipped/${order.id || order.order_number || "unknown"}`,
  );
}

/** Email di ordine consegnato */
export async function sendOrderDeliveredEmail(to: string, order: OrderEmailData): Promise<boolean> {
  const content = `
    <h1 style="font-size:22px;margin:0 0 16px;">Ordine consegnato! 📦</h1>
    <p>Ciao ${firstName(order)},</p>
    <p>Il tuo ordine <strong>#${orderRef(order)}</strong> è stato consegnato.</p>
    <p>Speriamo che tu sia soddisfatto del tuo acquisto. Grazie per aver scelto Mimmo Fratelli!</p>`;
  return sendEmail(
    to,
    `Ordine consegnato #${order.order_number || ""} - Mimmo Fratelli`,
    emailShell(content),
    `order-delivered/${order.id || order.order_number || "unknown"}`,
  );
}

const GIFT_CARD_STYLES: Record<string, { bgColor: string; textColor: string }> = {
  elegant: { bgColor: "#1a1a1a", textColor: "#d4af37" },
  festive: { bgColor: "#b71c1c", textColor: "#ffffff" },
  nature: { bgColor: "#2e5339", textColor: "#e8f5e9" },
  minimal: { bgColor: "#f5f5f2", textColor: "#333333" },
};

/** Email gift card al destinatario (tutti i campi utente sono escapati) */
export async function sendGiftCardEmailTo(giftCard: GiftCardEmailData): Promise<boolean> {
  const style = GIFT_CARD_STYLES[giftCard.template || ""] || GIFT_CARD_STYLES.elegant;
  const content = `
    <div style="background:${style.bgColor};color:${style.textColor};padding:40px 24px;text-align:center;border-radius:12px;">
      <div style="font-size:26px;letter-spacing:2px;margin-bottom:16px;">Mimmo Fratelli</div>
      <div style="font-size:22px;margin-bottom:8px;">Gift Card</div>
      <div style="font-size:46px;font-weight:bold;margin:16px 0;">€${Number(giftCard.amount || 0).toFixed(2)}</div>
      <div style="background:rgba(255,255,255,0.12);padding:14px 28px;border-radius:8px;font-size:22px;letter-spacing:3px;display:inline-block;margin:16px 0;">${escapeHtml(giftCard.code)}</div>
      ${giftCard.message ? `<div style="font-style:italic;margin:20px 0;padding:16px;border-top:1px solid rgba(255,255,255,0.25);border-bottom:1px solid rgba(255,255,255,0.25);">"${escapeHtml(giftCard.message)}"</div>` : ""}
      ${giftCard.sender_name ? `<div style="margin-top:16px;font-size:14px;">Da: ${escapeHtml(giftCard.sender_name)}</div>` : ""}
    </div>
    <div style="text-align:center;padding-top:20px;color:#555;font-size:14px;">
      <p>Utilizza questo codice su <a href="${SITE_URL}" style="color:${BRAND_COLOR};">mimmofratelli.com</a> al momento del checkout.</p>
      ${giftCard.expires_at ? `<p>Valida fino al ${escapeHtml(new Date(giftCard.expires_at).toLocaleDateString("it-IT"))}.</p>` : ""}
    </div>`;
  return sendEmail(
    giftCard.recipient_email,
    `${escapeHtml(giftCard.sender_name || "Qualcuno")} ti ha inviato una Gift Card Mimmo Fratelli 🎁`,
    emailShell(content),
    `gift-card/${giftCard.id || giftCard.stripe_session_id || giftCard.code}`,
  );
}
