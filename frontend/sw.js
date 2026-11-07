// Service worker της εφαρμογής. Δεν κρατάει τίποτα σε cache ώστε ο χρήστης να
// βλέπει πάντα την τελευταία έκδοση — εδώ θα μπουν αργότερα και τα push notifications.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
