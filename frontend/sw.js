// Service worker της εφαρμογής. Δεν κρατάει τίποτα σε cache ώστε ο χρήστης να
// βλέπει πάντα την τελευταία έκδοση. Εδώ φτάνουν και οι ειδοποιήσεις push.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Το κείμενο έρχεται από το backend και είναι πάντα ουδέτερο (π.χ. «Έχεις νέο μήνυμα»).
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const target = { open: data.open || "home", board: data.board || null };
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Αν ο χρήστης έχει ήδη ανοιχτή και μπροστά την εφαρμογή, δεν χρειάζεται ειδοποίηση.
    const visible = windows.find((c) => c.visibilityState === "visible" && c.focused);
    if (visible && data.tag !== "test") { visible.postMessage({ type: "push", ...target }); return; }
    await self.registration.showNotification(data.title || "Mentor", {
      body: data.body || "Έχεις κάτι νέο",
      tag: data.tag || "mentor",
      renotify: true,
      icon: "assets/app-icon-192.png",
      badge: "assets/app-icon-192.png",
      lang: "el",
      data: target,
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data || { open: "home" };
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows.length) {
      const client = windows[0];
      await client.focus().catch(() => {});
      client.postMessage({ type: "open", ...target });
      return;
    }
    const params = new URLSearchParams({ open: target.open });
    if (target.board) params.set("board", target.board);
    await self.clients.openWindow(`./index.html?${params}`);
  })());
});

// Ο browser άλλαξε μόνος του τη συνδρομή: η εφαρμογή θα τη στείλει ξανά στο backend στο επόμενο άνοιγμα.
self.addEventListener("pushsubscriptionchange", () => {});
