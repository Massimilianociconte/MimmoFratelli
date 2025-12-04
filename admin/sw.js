/**
 * CMS Service Worker - Mimmo Fratelli Admin PWA
 * Includes Firebase Cloud Messaging support
 */

// Import Firebase scripts for push notifications
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

const CACHE_NAME = 'mf-cms-v2';
const STATIC_ASSETS = [
  '/admin/',
  '/admin/index.html',
  '/admin/admin.css',
  '/admin/admin.js',
  '/js/config.js',
  '/js/supabase.js'
];

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
const messaging = firebase.messaging();

// Handle background messages (DATA-ONLY messages)
messaging.onBackgroundMessage((payload) => {
  console.log('[CMS SW] Background message received:', payload);
  
  const data = payload.data || {};
  const title = data.title || '🍅 Mimmo Fratelli';
  const body = data.body || 'Hai una nuova notifica';
  
  const options = {
    body: body,
    icon: data.icon || '/Images/icons/icon-192.png',
    badge: data.badge || '/Images/icons/badge-72.png',
    image: data.image && data.image.length > 0 ? data.image : undefined,
    tag: data.tag || `cms-${Date.now()}`,
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: { url: data.url || '/admin/', ...data },
    actions: [
      { action: 'view', title: '👀 Vedi' },
      { action: 'dismiss', title: '✕ Chiudi' }
    ]
  };
  
  return self.registration.showNotification(title, options);
});

// Handle push event directly (fallback)
self.addEventListener('push', (event) => {
  if (event.data) {
    try {
      const payload = event.data.json();
      if (payload.data && !payload.notification) {
        const data = payload.data;
        const title = data.title || '🍅 Mimmo Fratelli';
        const options = {
          body: data.body || 'Nuova notifica',
          icon: data.icon || '/Images/icons/icon-192.png',
          badge: '/Images/icons/badge-72.png',
          image: data.image && data.image.length > 0 ? data.image : undefined,
          tag: data.tag || `push-${Date.now()}`,
          renotify: true,
          requireInteraction: true,
          data: { url: data.url || '/', ...data }
        };
        event.waitUntil(self.registration.showNotification(title, options));
      }
    } catch (e) {
      console.error('[CMS SW] Push parse error:', e);
    }
  }
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  
  const url = event.notification.data?.url || '/admin/';
  const fullUrl = new URL(url, self.location.origin).href;
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(fullUrl);
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(fullUrl);
        }
      })
  );
});

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[CMS SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  console.log('[CMS SW] Activated');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => name.startsWith('mf-cms-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

console.log('[CMS SW] Service Worker loaded');
