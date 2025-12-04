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
  const fullUrl = new URL(urlToOpen, self.location.origin).href;

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

// Activate immediately
self.addEventListener('activate', (event) => {
  console.log('[FCM SW] Service Worker activated');
  event.waitUntil(clients.claim());
});

// Install immediately
self.addEventListener('install', (event) => {
  console.log('[FCM SW] Service Worker installed');
  self.skipWaiting();
});

console.log('[FCM SW] Service Worker loaded and ready');
