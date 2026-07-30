/**
 * Send FCM Notification Edge Function
 * Mimmo Fratelli E-commerce Platform
 *
 * Invio REALE di notifiche push tramite Firebase Cloud Messaging HTTP v1 API.
 * L'autenticazione verso Google avviene tramite un service account (OAuth2 JWT bearer).
 * I destinatari sono i token registrati in `fcm_tokens` (FCM è il sistema autoritativo).
 *
 * Payload accettato (dal pannello admin):
 *   { product_id?, notification_type, title?, body?, url? }
 * Risposta:
 *   { success: true, sent: number, failed: number, method: 'fcm' }
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  handleCorsPreflightRequest,
  createResponse,
  createErrorResponse,
} from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

interface NotificationBody {
  product_id?: string;
  notification_type?: string;
  title?: string;
  body?: string;
  url?: string;
}

/**
 * Base64 URL encode (no padding)
 */
function base64UrlEncode(input: string | Uint8Array): string {
  let binary: string;
  if (typeof input === "string") {
    binary = btoa(input);
  } else {
    binary = btoa(String.fromCharCode(...input));
  }
  return binary.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Firma RS256 con la chiave privata del service account (PKCS8)
 */
async function signRS256(data: string, privateKeyPem: string): Promise<string> {
  const pemContents = privateKeyPem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");

  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(data),
  );

  return base64UrlEncode(new Uint8Array(signature));
}

/**
 * Ottiene un access token OAuth2 per FCM tramite JWT bearer del service account.
 */
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const signature = await signRS256(unsigned, sa.private_key);
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`OAuth2 token error: ${JSON.stringify(data)}`);
  }
  return data.access_token as string;
}

/**
 * Invia un messaggio data-only a un singolo token FCM.
 * Ritorna se l'invio è andato a buon fine e se il token è invalido (da rimuovere).
 */
async function sendToToken(
  accessToken: string,
  projectId: string,
  token: string,
  data: Record<string, string>,
): Promise<{ ok: boolean; invalid: boolean }> {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          // Messaggio data-only: la costruzione della notifica avviene nel
          // service worker (onBackgroundMessage), coerente con firebase-messaging-sw.js
          data,
          webpush: {
            fcmOptions: data.url ? { link: data.url } : undefined,
          },
        },
      }),
    },
  );

  if (res.ok) return { ok: true, invalid: false };

  const err = await res.json().catch(() => ({}));
  const errorStatus = err?.error?.status;
  const errorCode = err?.error?.details?.[0]?.errorCode;
  // Token non più valido/registrato: va rimosso dal database
  const invalid =
    res.status === 404 ||
    errorStatus === "NOT_FOUND" ||
    errorStatus === "UNREGISTERED" ||
    errorCode === "UNREGISTERED";
  console.error(`FCM send failed (${res.status}):`, JSON.stringify(err));
  return { ok: false, invalid };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreflightRequest(req);
  }

  if (req.method !== "POST") {
    return createErrorResponse("Method not allowed", req, 405);
  }

  try {
    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      throw new Error("Missing Supabase environment variables");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });

    // 1. Autenticazione + verifica ruolo admin
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) {
      return createErrorResponse("Unauthorized", req, 401);
    }

    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!adminRole) {
      return createErrorResponse("Forbidden", req, 403);
    }

    // 2. Service account FCM (secret Supabase)
    const saRaw = Deno.env.get("FCM_SERVICE_ACCOUNT");
    if (!saRaw) {
      return createErrorResponse(
        "FCM_SERVICE_ACCOUNT non configurato",
        req,
        500,
      );
    }
    let sa: ServiceAccount;
    try {
      sa = JSON.parse(saRaw);
    } catch {
      return createErrorResponse("FCM_SERVICE_ACCOUNT non è un JSON valido", req, 500);
    }
    if (!sa.project_id || !sa.client_email || !sa.private_key) {
      return createErrorResponse("FCM_SERVICE_ACCOUNT incompleto", req, 500);
    }

    // 3. Parsing e normalizzazione del payload
    const body: NotificationBody = await req.json().catch(() => ({}));
    const notificationType = body.notification_type || "seasonal_product";

    let title = body.title || "Mimmo Fratelli";
    let bodyText = body.body || "Hai una nuova notifica!";
    let url = body.url || "/";
    let productName = "";

    if (body.product_id) {
      const { data: product, error: productError } = await supabase
        .from("products")
        .select("*")
        .eq("id", body.product_id)
        .single();

      if (productError || !product) {
        return createErrorResponse("Prodotto non trovato", req, 404);
      }

      productName = product.name;
      title = body.title || "🍅 Nuovo Prodotto di Stagione!";
      bodyText = body.body || `${product.name} è ora disponibile! Fresco e di stagione.`;
      url = body.url || `/product.html?id=${body.product_id}`;
    }

    // 4. Selezione dei destinatari (token FCM)
    const { data: tokenRows, error: tokenError } = await supabase
      .from("fcm_tokens")
      .select("token, user_id");

    if (tokenError) {
      throw tokenError;
    }

    // Filtro preferenza notifiche stagionali (non applicato ai test).
    // Difensivo: se la colonna/tabella non è disponibile, non si filtra per preferenza.
    let enabledUserIds: Set<string> | null = null;
    if (notificationType !== "test") {
      const { data: profiles, error: profErr } = await supabase
        .from("profiles")
        .select("id")
        .eq("seasonal_notifications", true);
      if (!profErr && profiles) {
        enabledUserIds = new Set(profiles.map((p: { id: string }) => p.id));
      }
    }

    const recipients = (tokenRows || []).filter((row: { token: string; user_id: string | null }) => {
      if (!row.token) return false;
      if (notificationType === "test" || enabledUserIds === null) return true;
      // Token anonimi (senza user_id) hanno acconsentito abilitando i permessi push
      if (!row.user_id) return true;
      return enabledUserIds.has(row.user_id);
    });

    if (recipients.length === 0) {
      return createResponse(
        { success: true, sent: 0, failed: 0, method: "fcm", message: "Nessun destinatario iscritto." },
        req,
      );
    }

    // 5. Access token OAuth2 e invio
    const accessToken = await getAccessToken(sa);

    const dataPayload: Record<string, string> = {
      title,
      body: bodyText,
      url,
      type: notificationType,
    };
    if (productName) dataPayload.product_name = productName;
    if (body.product_id) dataPayload.product_id = body.product_id;

    let sent = 0;
    let failed = 0;
    const invalidTokens: string[] = [];

    // Invio a chunk per limitare la concorrenza
    const CHUNK = 100;
    for (let i = 0; i < recipients.length; i += CHUNK) {
      const chunk = recipients.slice(i, i + CHUNK);
      const results = await Promise.allSettled(
        chunk.map((r: { token: string }) =>
          sendToToken(accessToken, sa.project_id, r.token, dataPayload)
        ),
      );
      results.forEach((res, idx) => {
        if (res.status === "fulfilled" && res.value.ok) {
          sent++;
        } else {
          failed++;
          if (res.status === "fulfilled" && res.value.invalid) {
            invalidTokens.push(chunk[idx].token);
          }
        }
      });
    }

    // 6. Pulizia token non più validi
    if (invalidTokens.length > 0) {
      await supabase.from("fcm_tokens").delete().in("token", invalidTokens);
      console.log(`Rimossi ${invalidTokens.length} token FCM non più validi.`);
    }

    // 7. Log aggregato dell'invio
    await supabase.from("notification_logs").insert({
      user_id: user.id,
      type: notificationType,
      title,
      body: bodyText,
      data: { product_id: body.product_id || null, product_name: productName, sent, failed },
      product_id: body.product_id || null,
      status: sent > 0 ? "sent" : "failed",
    });

    return createResponse({ success: true, sent, failed, method: "fcm" }, req);
  } catch (error) {
    console.error("send-fcm-notification error:", error);
    return createErrorResponse(
      error instanceof Error ? error.message : "Errore interno",
      req,
      500,
    );
  }
});
