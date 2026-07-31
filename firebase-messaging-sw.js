/**
 * Firebase Messaging Service Worker
 * Mimmo Fratelli E-commerce Platform
 * 
 * Handles background push notifications from Firebase Cloud Messaging
 * Works with DATA-ONLY messages for reliable background delivery
 */

// Import Firebase scripts
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAiBAKd6FbbpEyF5pfZAtQLgiwlybg_bf4",
  authDomain: "mimmo-fratelli.firebaseapp.com",
  projectId: "mimmo-fratelli",
  storageBucket: "mimmo-fratelli.firebasestorage.app",
  messagingSenderId: "1017122435840",
  appId: "1:1017122435840:web:dbd2685674ebdd2d6339e5"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Get messaging instance
const messaging = firebase.messaging();

// ============================================
// Cache + strategia di aggiornamento
// Questo è l'UNICO service worker attivo a scope '/', quindi gestisce sia le
// push (sotto) sia il caching degli asset. Strategia: network-first con
// rivalidazione forzata per HTML/JS/CSS, così un deploy nuovo non resta
// nascosto dietro il lungo max-age (Browser Cache TTL) impostato da Cloudflare.
// ============================================
const CACHE_NAME = 'mimmo-fratelli-fcm-v1';

// Handle background messages (DATA-ONLY messages)
messaging.onBackgroundMessage((payload) => {
  console.log('[FCM SW] Background message received:', payload);

  // Extract data from payload.data (data-only message)
  const data = payload.data || {};
  
  const title = data.title || '🍅 Mimmo Fratelli';
  const body = data.body || 'Hai una nuova notifica';
  const image = data.image || null;
  const icon = data.icon || '/Images/icons/icon-192.png';
  const badge = data.badge || '/Images/icons/badge-72.png';
  const url = data.url || '/';
  const tag = data.tag || `fcm-${Date.now()}`;

  const notificationOptions = {
    body: body,
    icon: icon,
    badge: badge,
    image: image && image.length > 0 ? image : undefined,
    tag: tag,
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: {
      url: url,
      product_id: data.product_id,
      type: data.type,
      timestamp: data.timestamp
    },
    actions: [
      {
        action: 'view',
        title: '👀 Vedi'
      },
      {
        action: 'dismiss',
        title: '✕ Chiudi'
      }
    ]
  };

  console.log('[FCM SW] Showing notification:', title, notificationOptions);
  
  return self.registration.showNotification(title, notificationOptions);
});

// Note: We don't need a separate 'push' event listener because
// messaging.onBackgroundMessage already handles FCM data-only messages.
// Having both would cause duplicate notifications.

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  console.log('[FCM SW] Notification clicked:', event.action);
  
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const urlToOpen = event.notification.data?.url || '/';
  let fullUrl;
  try {
    const parsed = new URL(urlToOpen, self.location.origin);
    fullUrl = parsed.origin === self.location.origin ? parsed.href : new URL('/', self.location.origin).href;
  } catch (e) {
    fullUrl = new URL('/', self.location.origin).href;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Check if there's already a window open
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(fullUrl);
            return client.focus();
          }
        }
        // Open new window
        if (clients.openWindow) {
          return clients.openWindow(fullUrl);
        }
      })
  );
});

// Handle notification close
self.addEventListener('notificationclose', (event) => {
  console.log('[FCM SW] Notification closed');
});

// Activate immediately + pulizia delle vecchie cache
self.addEventListener('activate', (event) => {
  console.log('[FCM SW] Service Worker activated');
  event.waitUntil(
    Promise.all([
      caches.keys().then((names) =>
        Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
      ),
      clients.claim(),
    ])
  );
});

// Fetch: network-first con rivalidazione forzata per documenti/JS/CSS/JSON,
// cache-first per gli altri asset (immagini/font). Fallback offline dalla cache.
// La rivalidazione forzata (cache: 'no-cache') aggira il max-age lungo del
// browser, quindi ad ogni deploy gli utenti ricevono subito i file aggiornati.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = req.url;

  // Solo same-origin; salta API/Edge Functions (gestite direttamente dalla rete)
  if (!url.startsWith(self.location.origin)) return;
  if (url.includes('/rest/') || url.includes('supabase') || url.includes('/functions/')) return;

  const mustRevalidate = req.mode === 'navigate' || /\.(?:js|mjs|css|html|json)(?:\?|$)/i.test(url);

  if (mustRevalidate) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return response;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const fromNetwork = fetch(req)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fromNetwork;
    })
  );
});

// Install immediately
self.addEventListener('install', (event) => {
  console.log('[FCM SW] Service Worker installed');
  self.skipWaiting();
});

console.log('[FCM SW] Service Worker loaded and ready');
