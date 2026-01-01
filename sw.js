/**
 * Service Worker - Mimmo Fratelli
 * Handles push notifications and offline caching
 */

const CACHE_NAME = 'mimmo-fratelli-v2';

// Get base path dynamically
const getBasePath = () => {
  // For www.mimmofratelli.com, base path is empty
  // This function is kept for compatibility with local development
  return '';
};

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  
  const basePath = getBasePath();
  const STATIC_ASSETS = [
    `${basePath}/`,
    `${basePath}/index.html`,
    `${basePath}/collection.html`,
    `${basePath}/css/style.css`
  ];
  
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets with basePath:', basePath);
      // Use addAll with catch to handle individual failures gracefully
      return Promise.all(
        STATIC_ASSETS.map(url => 
          cache.add(url).catch(err => {
            console.warn('[SW] Failed to cache:', url, err.message);
          })
        )
      );
    })
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;
  
  // Skip API requests and external URLs
  if (event.request.url.includes('/rest/') || 
      event.request.url.includes('supabase') ||
      !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache
        return caches.match(event.request);
      })
  );
});

// Push event - handle incoming push notifications
self.addEventListener('push', (event) => {
  console.log('[SW] Push received:', event);
  
  let data = {
    title: 'Mimmo Fratelli',
    body: 'Hai una nuova notifica!',
    icon: '/Images/icons/icon-192.png',
    badge: '/Images/icons/badge-72.png',
    image: null,
    url: '/',
    tag: 'default'
  };

  try {
    if (event.data) {
      const payload = event.data.json();
      data = { ...data, ...payload };
    }
  } catch (e) {
    console.error('[SW] Error parsing push data:', e);
  }

  const options = {
    body: data.body,
    icon: data.icon || '/Images/icons/icon-192.png',
    badge: data.badge || '/Images/icons/badge-72.png',
    image: data.image, // Large image preview
    tag: data.tag || 'notification',
    renotify: true,
    requireInteraction: true, // Keep notification until user interacts
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/',
      productId: data.productId,
      timestamp: Date.now()
    },
    actions: [
      {
        action: 'view',
        title: '👀 Vedi Prodotto'
      },
      {
        action: 'dismiss',
        title: '✕ Chiudi'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification click event - handle user interaction
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.action);
  
  event.notification.close();
  
  if (event.action === 'dismiss') {
    return;
  }
  
  // Get the URL to open
  const urlToOpen = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Check if there's already a window open
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(urlToOpen);
            return client.focus();
          }
        }
        // If no window is open, open a new one
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// Notification close event - track dismissals
self.addEventListener('notificationclose', (event) => {
  console.log('[SW] Notification closed by user');
});

// Message event - communicate with main thread
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
