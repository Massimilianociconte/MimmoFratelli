/**
 * Mimmo Fratelli Configuration
 * 
 * This file contains the client-side configuration.
 * For production, replace these values with your actual credentials.
 * 
 * IMPORTANT: Never commit real API keys to version control!
 */

window.AVENUE_CONFIG = {
  // Supabase Configuration
  SUPABASE_URL: 'https://onvufwqybriaoadsdjyk.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9udnVmd3F5YnJpYW9hZHNkanlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ1MzU1NjUsImV4cCI6MjA4MDExMTU2NX0._IfTakzx5GVgxCEsdo1IASkKuEjeYsxyxfNWDZDMEJw',
  
  // Stripe Configuration (publishable key only - safe for client)
  STRIPE_PUBLISHABLE_KEY: 'pk_test_51SZTISFNqazzxXHEwgx2nCmMaJfslgZ17H1QMeeWlj8Zjk7hzHystoCKkp8u2UpytNBRpNKAVceXYogK4htalZ2K00lT2LyoxB',
  
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
  MAX_CART_QUANTITY: 50,
  
  // Shipping
  FREE_SHIPPING_THRESHOLD: 50, // Spedizione gratuita sopra €50
  STANDARD_SHIPPING_COST: 4.90, // €4.90 spedizione standard
  
  // Rate Limiting
  MAX_LOGIN_ATTEMPTS: 5,
  LOGIN_LOCKOUT_MINUTES: 15
};

// Freeze config to prevent modifications
Object.freeze(window.AVENUE_CONFIG);
