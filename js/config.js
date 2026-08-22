/**
 * Mimmo Fratelli Configuration
 * 
 * This file contains the client-side configuration.
 * For production, replace these values with your actual credentials.
 * 
 * Only public browser configuration belongs in this file. Server credentials
 * are stored exclusively as Edge Function secrets.
 */

window.AVENUE_CONFIG = {
  // Supabase Configuration
  SUPABASE_URL: 'https://onvufwqybriaoadsdjyk.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9udnVmd3F5YnJpYW9hZHNkanlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ1MzU1NjUsImV4cCI6MjA4MDExMTU2NX0._IfTakzx5GVgxCEsdo1IASkKuEjeYsxyxfNWDZDMEJw',
  
  // PayPal Configuration
  PAYPAL_CLIENT_ID: '',
  
  // Push Notifications - VAPID Public Key (legacy, use Firebase instead)
  VAPID_PUBLIC_KEY: 'BNwa-DzFzjnCEBb-rKAbgAwPwAziEL5o1YOxvtflk9VscLO2gqYvFQBBoBHY262Cgh_NhM4O3zEjd3FK2qek1gY',
  
  // Firebase Configuration for Push Notifications
  FIREBASE: {
    apiKey: "AIzaSyAiBAKd6FbbpEyF5pfZAtQLgiwlybg_bf4",
    authDomain: "mimmo-fratelli.firebaseapp.com",
    projectId: "mimmo-fratelli",
    storageBucket: "mimmo-fratelli.firebasestorage.app",
    messagingSenderId: "1017122435840",
    appId: "1:1017122435840:web:dbd2685674ebdd2d6339e5",
    vapidKey: "BBw7R7su7QQIMPDnrnoR5E4-MO_KUMh9Qe8_2ZatW94OKHGyMEc7HSsZ-GsEt8tSrj7e7_qyqUQX-HF0758RM9w"
  },
  
  // Application Settings
  APP_NAME: 'Mimmo Fratelli',
  APP_VERSION: '1.0.0',
  
  // Currency and Locale
  CURRENCY: 'EUR',
  LOCALE: 'it-IT',
  
  // Cart Settings
  MAX_CART_QUANTITY: 10,
  
  // Shipping
  FREE_SHIPPING_THRESHOLD: 50, // Spedizione gratuita sopra €50
  STANDARD_SHIPPING_COST: 2.90, // €2.90 spedizione standard

  // WhatsApp del corriere per la notifica ordine in checkout-success.
  // Formato internazionale senza "+". ATTENZIONE: i dati cliente vengono
  // condivisi con questo numero — deve appartenere al corriere/azienda.
  WHATSAPP_RIDER_NUMBER: '393208867172',

  // Rate Limiting
  MAX_LOGIN_ATTEMPTS: 5,
  LOGIN_LOCKOUT_MINUTES: 15
};

// Freeze config to prevent modifications
Object.freeze(window.AVENUE_CONFIG);

// Load the shared legal navigation from the site root. Deriving the root from
// this script keeps the component working on both root pages and /admin/.
(function loadLegalNavigation() {
  const configSource = document.currentScript?.src;
  if (!configSource) return;

  const siteRoot = new URL('../', configSource);
  const stylesheetUrl = new URL('css/legal-navigation.css', siteRoot).href;
  const scriptUrl = new URL('js/components/legal-navigation.js', siteRoot).href;

  if (!document.querySelector(`link[href="${stylesheetUrl}"]`)) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = stylesheetUrl;
    document.head.append(stylesheet);
  }

  if (!document.querySelector(`script[src="${scriptUrl}"]`)) {
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.defer = true;
    document.head.append(script);
  }
})();
