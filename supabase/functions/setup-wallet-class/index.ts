/**
 * Setup Google Wallet Class
 * Mimmo Fratelli E-commerce Platform
 * 
 * Creates the Generic Pass Class for gift cards on Google Wallet
 * Run this ONCE to set up the class, then it can be reused for all gift cards
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest, createResponse, createErrorResponse } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreflightRequest(req);
  }

  if (req.method !== "POST") {
    return createErrorResponse("Method not allowed", req, 405);
  }

  try {
    // Admin-only: this function creates/modifies the shared Google Wallet class
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseAdmin = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );
    const supabaseUser = createClient(
      supabaseUrl,
      supabaseAnonKey,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } }
    );

    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const { data: adminRole } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!adminRole) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const issuerId = Deno.env.get("GOOGLE_WALLET_ISSUER_ID");
    const serviceAccountEmail = Deno.env.get("GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL");
    const privateKeyPem = Deno.env.get("GOOGLE_WALLET_PRIVATE_KEY");
    const baseUrl = Deno.env.get("SITE_URL") || "https://www.mimmofratelli.com";

    if (!issuerId || !serviceAccountEmail || !privateKeyPem) {
      return createErrorResponse("Google Wallet credentials not configured", req, 500);
    }

    const classId = `${issuerId}.mimmo_fratelli_giftcard`;

    // Get access token
    const accessToken = await getGoogleAccessToken(serviceAccountEmail, privateKeyPem);
    
    // Check if this is a force recreate request
    const url = new URL(req.url);
    const forceRecreate = url.searchParams.get("recreate") === "true";

    // Define the Generic Class for gift cards
    // reviewStatus: "UNDER_REVIEW" allows passes to be saved by any user once issuer is approved
    const genericClass = {
      id: classId,
      // Required for production: allows all users to save passes (not just test accounts)
      reviewStatus: "UNDER_REVIEW",
      classTemplateInfo: {
        cardTemplateOverride: {
          cardRowTemplateInfos: [
            {
              twoItems: {
                startItem: {
                  firstValue: {
                    fields: [
                      {
                        fieldPath: "object.textModulesData['balance']"
                      }
                    ]
                  }
                },
                endItem: {
                  firstValue: {
                    fields: [
                      {
                        fieldPath: "object.textModulesData['code']"
                      }
                    ]
                  }
                }
              }
            },
            {
              twoItems: {
                startItem: {
                  firstValue: {
                    fields: [
                      {
                        fieldPath: "object.textModulesData['recipient']"
                      }
                    ]
                  }
                },
                endItem: {
                  firstValue: {
                    fields: [
                      {
                        fieldPath: "object.textModulesData['sender']"
                      }
                    ]
                  }
                }
              }
            }
          ]
        }
      },
      linksModuleData: {
        uris: [
          {
            uri: baseUrl,
            description: "Visita Mimmo Fratelli",
            id: "website"
          },
          {
            uri: `${baseUrl}/contacts.html`,
            description: "Contattaci",
            id: "contact"
          }
        ]
      },
      enableSmartTap: false,
      multipleDevicesAndHoldersAllowedStatus: "ONE_USER_ALL_DEVICES"
    };

    // Try to create the class (or update if exists)
    console.log("Checking if class exists:", classId);
    console.log("Force recreate:", forceRecreate);
    
    let response = await fetch(
      `https://walletobjects.googleapis.com/walletobjects/v1/genericClass/${classId}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`
        }
      }
    );

    console.log("GET class response status:", response.status);
    
    // If force recreate and class exists, delete it first
    if (forceRecreate && response.ok) {
      console.log("Force recreate requested, deleting existing class...");
      // Note: Google Wallet API doesn't support DELETE for classes
      // We need to update it instead with new settings
    }

    if (response.status === 404) {
      // Class doesn't exist, create it
      console.log("Class not found, creating new class...");
      response = await fetch(
        "https://walletobjects.googleapis.com/walletobjects/v1/genericClass",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(genericClass)
        }
      );

      if (!response.ok) {
        const error = await response.text();
        console.error("Failed to create class:", error);
        return createErrorResponse(`Failed to create class: ${error}`, req, 500);
      }

      const createdClass = await response.json();
      return createResponse({
        success: true,
        message: "Generic Class created successfully",
        classId: classId,
        class: createdClass
      }, req);
    } else if (response.ok) {
      // Class exists, update it
      console.log("Class exists, updating...");
      response = await fetch(
        `https://walletobjects.googleapis.com/walletobjects/v1/genericClass/${classId}`,
        {
          method: "PUT",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(genericClass)
        }
      );

      if (!response.ok) {
        const error = await response.text();
        console.error("Failed to update class:", error);
        return createErrorResponse(`Failed to update class: ${error}`, req, 500);
      }

      const updatedClass = await response.json();
      return createResponse({
        success: true,
        message: "Generic Class updated successfully",
        classId: classId,
        class: updatedClass
      }, req);
    } else {
      // Other error (e.g., 401, 403)
      const errorText = await response.text();
      console.error("Error checking class:", response.status, errorText);
      return createErrorResponse(`Error checking class (${response.status}): ${errorText}`, req, 500);
    }

  } catch (error) {
    console.error("Setup wallet class error:", error);
    return createErrorResponse(error instanceof Error ? error.message : "Errore interno", req, 500);
  }
});

/**
 * Get Google OAuth2 access token using service account
 */
async function getGoogleAccessToken(serviceAccountEmail: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccountEmail,
    scope: "https://www.googleapis.com/auth/wallet_object.issuer",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaims = base64UrlEncode(JSON.stringify(claims));
  const signatureInput = `${encodedHeader}.${encodedClaims}`;
  
  const signature = await signWithRSA(signatureInput, privateKeyPem);
  const jwt = `${signatureInput}.${signature}`;

  // Exchange JWT for access token
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    throw new Error(`Failed to get access token: ${error}`);
  }

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

function base64UrlEncode(str: string): string {
  const base64 = btoa(str);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signWithRSA(data: string, privateKeyPem: string): Promise<string> {
  const pemContents = privateKeyPem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    encoder.encode(data)
  );
  
  const signatureArray = new Uint8Array(signature);
  const signatureBase64 = btoa(String.fromCharCode(...signatureArray));
  return signatureBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
