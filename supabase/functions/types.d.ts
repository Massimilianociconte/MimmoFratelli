/**
 * Deno type declarations for Supabase Edge Functions
 * These declarations allow TypeScript to recognize Deno APIs in the local IDE
 */

declare namespace Deno {
  export interface Env {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    has(key: string): boolean;
    toObject(): { [key: string]: string };
  }

  export const env: Env;

  export function serve(handler: (request: Request) => Response | Promise<Response>): void;
}

declare module "https://esm.sh/@supabase/supabase-js@2" {
  export * from "@supabase/supabase-js";
}

declare module "https://esm.sh/stripe@14.14.0?target=deno" {
  import Stripe from "stripe";
  export default Stripe;
}

declare module "jsr:@supabase/supabase-js@2" {
  export * from "@supabase/supabase-js";
}

declare module "jsr:@supabase/functions-js/edge-runtime.d.ts" {
  // Edge runtime types
}
