/**
 * Add to Wallet Edge Function
 * Mimmo Fratelli E-commerce Platform
 * 
 * Generates Google Wallet and Apple Wallet passes for gift cards
 * Google Wallet uses signed JWT tokens as per API requirements
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest, createResponse, createErrorResponse } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface WalletRequest {
  giftCardId: string;
  walletType: "google" | "apple";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreflightRequest(req);
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { giftCardId, walletType }: WalletRequest = await req.json();

    console.log("Add to wallet request:", { giftCardId, walletType });

    if (!giftCardId || !walletType) {
      return createErrorResponse("giftCardId e walletType sono richiesti", req, 400);
    }

    // Fetch gift card details
    const { data: giftCard, error: fetchError } = await supabase
      .from("gift_cards")
      .select("*")
      .eq("id", giftCardId)
      .single();

    console.log("Gift card fetch result:", { found: !!giftCard, error: fetchError?.message });

    if (fetchError || !giftCard) {
      return createErrorResponse("Gift card non trovata", req, 404);
    }

    const baseUrl = Deno.env.get("SITE_URL") || "https://mimmofratelli.it";
    const redeemUrl = `${baseUrl}/redeem.html?token=${giftCard.qr_code_token}`;

    if (walletType === "google") {
      const googlePassUrl = await generateGoogleWalletUrl(giftCard, redeemUrl, baseUrl);
      
      return createResponse({ 
        success: true, 
        walletUrl: googlePassUrl,
        walletType: "google"
      }, req);
    } else if (walletType === "apple") {
      const applePassData = generateAppleWalletData(giftCard, redeemUrl, baseUrl);
      
      return createResponse({ 
        success: true, 
        passData: applePassData,
        walletType: "apple"
      }, req);
    }

    return createErrorResponse("Tipo wallet non supportato", req, 400);

  } catch (error) {
    console.error("Wallet error:", error);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    console.error("Error name:", error.name);
    return createErrorResponse(error.message || "Errore interno", req, 500);
  }
});

/**
 * Create a signed JWT for Google Wallet
 */
async function createSignedJwt(payload: object): Promise<string> {
  console.log("Creating signed JWT...");
  const privateKeyPem = Deno.env.get("GOOGLE_WALLET_PRIVATE_KEY") || "";
  const serviceAccountEmail = Deno.env.get("GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL") || "";
  
  console.log("Service account email:", serviceAccountEmail ? "configured" : "MISSING");
  console.log("Private key:", privateKeyPem ? `configured (${privateKeyPem.length} chars)` : "MISSING");
  
  if (!privateKeyPem || !serviceAccountEmail) {
    throw new Error("Google Wallet credentials not configured");
  }

  const header = {
    alg: "RS256",
    typ: "JWT"
  };

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: serviceAccountEmail,
    aud: "google",
    iat: now,
    typ: "savetowallet",
    origins: [Deno.env.get("SITE_URL") || "https://mimmofratelli.it"],
    payload: payload
  };

  // Base64url encode header and claims
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaims = base64UrlEncode(JSON.stringify(claims));
  const signatureInput = `${encodedHeader}.${encodedClaims}`;

  // Sign with RSA-SHA256
  const signature = await signWithRSA(signatureInput, privateKeyPem);
  
  return `${signatureInput}.${signature}`;
}

/**
 * Base64 URL encode (no padding)
 */
function base64UrlEncode(str: string): string {
  const base64 = btoa(str);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Sign data with RSA private key
 */
async function signWithRSA(data: string, privateKeyPem: string): Promise<string> {
  console.log("Signing with RSA...");
  console.log("Private key starts with:", privateKeyPem.substring(0, 50));
  
  // Clean up the PEM key
  const pemContents = privateKeyPem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  
  console.log("PEM contents length after cleanup:", pemContents.length);
  
  // Decode base64 to ArrayBuffer
  console.log("Decoding base64...");
  let binaryKey: Uint8Array;
  try {
    binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
    console.log("Binary key length:", binaryKey.length);
  } catch (e) {
    console.error("Base64 decode error:", e.message);
    throw new Error(`Failed to decode private key: ${e.message}`);
  }
  
  // Import the key
  console.log("Importing crypto key...");
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  // Sign the data
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    encoder.encode(data)
  );
  
  // Convert to base64url
  const signatureArray = new Uint8Array(signature);
  const signatureBase64 = btoa(String.fromCharCode(...signatureArray));
  return signatureBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}


/**
 * Get theme colors based on gift card template
 */
function getTemplateColors(template: string): { bg: string; accent: string } {
  const themes: Record<string, { bg: string; accent: string }> = {
    elegant: { bg: "#1a1a1a", accent: "#f9ca24" },
    avenue: { bg: "#2d5a3d", accent: "#8bc34a" },
    minimal: { bg: "#ffffff", accent: "#3d7c47" },
    festive: { bg: "#c0392b", accent: "#f1c40f" }
  };
  return themes[template] || themes.elegant;
}

/**
 * Generate Google Wallet pass URL using signed JWT
 * Uses Generic Pass type for gift cards (more flexible than GiftCard type)
 */
async function generateGoogleWalletUrl(giftCard: any, redeemUrl: string, baseUrl: string): Promise<string> {
  const issuerId = Deno.env.get("GOOGLE_WALLET_ISSUER_ID");
  
  if (!issuerId) {
    throw new Error("GOOGLE_WALLET_ISSUER_ID non configurato");
  }

  const classId = `${issuerId}.mimmo_fratelli_giftcard`;
  const objectId = `${issuerId}.giftcard_${giftCard.id.replace(/-/g, '_')}`;
  
  // Format expiration date
  const expiresAt = giftCard.expires_at 
    ? new Date(giftCard.expires_at).toISOString()
    : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  // Get theme colors based on template
  const template = giftCard.template || 'elegant';
  const colors = getTemplateColors(template);

  // Create Generic Pass Object with enhanced styling
  const genericObject = {
    id: objectId,
    classId: classId,
    genericType: "GENERIC_GIFT_CARD",
    cardTitle: {
      defaultValue: {
        language: "it",
        value: "Mimmo Fratelli"
      }
    },
    header: {
      defaultValue: {
        language: "it",
        value: `Gift Card EUR ${giftCard.amount}`
      }
    },
    subheader: {
      defaultValue: {
        language: "it",
        value: `Per: ${giftCard.recipient_name}`
      }
    },
    hexBackgroundColor: colors.bg,
    // Row layout for key info at top
    textModulesData: [
      {
        id: "balance",
        header: "SALDO",
        body: `EUR ${parseFloat(giftCard.remaining_balance).toFixed(2)}`
      },
      {
        id: "code",
        header: "CODICE",
        body: giftCard.code
      },
      {
        id: "recipient",
        header: "DESTINATARIO",
        body: giftCard.recipient_name
      },
      {
        id: "sender",
        header: "DA",
        body: giftCard.sender_name
      },
      ...(giftCard.message ? [{
        id: "message",
        header: "MESSAGGIO",
        body: giftCard.message
      }] : []),
      {
        id: "expiry",
        header: "SCADENZA",
        body: new Date(expiresAt).toLocaleDateString("it-IT", {
          day: "numeric",
          month: "long",
          year: "numeric"
        })
      }
    ],
    linksModuleData: {
      uris: [
        {
          uri: redeemUrl,
          description: "Riscatta Gift Card",
          id: "redeem"
        },
        {
          uri: `${baseUrl}/contacts.html`,
          description: "Contattaci",
          id: "contact"
        },
        {
          uri: baseUrl,
          description: "Visita Mimmo Fratelli",
          id: "website"
        }
      ]
    },
    barcode: {
      type: "QR_CODE",
      value: redeemUrl,
      alternateText: giftCard.code
    },
    validTimeInterval: {
      start: {
        date: giftCard.created_at || new Date().toISOString()
      },
      end: {
        date: expiresAt
      }
    },
    state: giftCard.is_redeemed ? "EXPIRED" : "ACTIVE"
  };

  // Create the JWT payload
  const payload = {
    genericObjects: [genericObject]
  };

  // Sign and create the JWT
  const jwt = await createSignedJwt(payload);
  
  // Return the Google Wallet save URL
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

/**
 * Generate Apple Wallet pass data
 * Returns pass.json structure - requires server-side signing for full implementation
 */
function generateAppleWalletData(giftCard: any, redeemUrl: string, baseUrl: string): object {
  const expirationDate = giftCard.expires_at 
    ? new Date(giftCard.expires_at).toISOString()
    : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  return {
    formatVersion: 1,
    passTypeIdentifier: Deno.env.get("APPLE_PASS_TYPE_ID") || "pass.com.mimmofratelli.giftcard",
    serialNumber: `giftcard_${giftCard.id}`,
    teamIdentifier: Deno.env.get("APPLE_TEAM_ID") || "MIMMO_FRATELLI",
    organizationName: "Mimmo Fratelli",
    description: "Gift Card Mimmo Fratelli",
    logoText: "Mimmo Fratelli",
    foregroundColor: "rgb(255, 255, 255)",
    backgroundColor: "rgb(26, 26, 26)",
    labelColor: "rgb(168, 153, 144)",
    storeCard: {
      headerFields: [
        {
          key: "balance",
          label: "SALDO",
          value: giftCard.remaining_balance,
          currencyCode: "EUR"
        }
      ],
      primaryFields: [
        {
          key: "amount",
          label: "VALORE",
          value: giftCard.amount,
          currencyCode: "EUR"
        }
      ],
      secondaryFields: [
        {
          key: "recipient",
          label: "DESTINATARIO",
          value: giftCard.recipient_name
        },
        {
          key: "sender",
          label: "DA",
          value: giftCard.sender_name
        }
      ],
      auxiliaryFields: [
        {
          key: "code",
          label: "CODICE",
          value: giftCard.code
        },
        {
          key: "expires",
          label: "SCADENZA",
          value: new Date(giftCard.expires_at).toLocaleDateString("it-IT"),
          dateStyle: "PKDateStyleMedium"
        }
      ],
      backFields: [
        {
          key: "message",
          label: "Messaggio",
          value: giftCard.message || "Buono shopping da Mimmo Fratelli!"
        },
        {
          key: "terms",
          label: "Termini e Condizioni",
          value: "Questa gift card è valida per 12 mesi dalla data di acquisto. Non è rimborsabile e non può essere convertita in denaro. Utilizzabile su mimmofratelli.it"
        },
        {
          key: "support",
          label: "Assistenza",
          value: "Per assistenza contattaci su mimmofratelli1996@gmail.com"
        }
      ]
    },
    barcode: {
      format: "PKBarcodeFormatQR",
      message: redeemUrl,
      messageEncoding: "iso-8859-1",
      altText: giftCard.code
    },
    barcodes: [
      {
        format: "PKBarcodeFormatQR",
        message: redeemUrl,
        messageEncoding: "iso-8859-1",
        altText: giftCard.code
      }
    ],
    expirationDate: expirationDate,
    voided: giftCard.is_redeemed || false,
    webServiceURL: `${baseUrl}/api/wallet`,
    authenticationToken: giftCard.qr_code_token
  };
}
