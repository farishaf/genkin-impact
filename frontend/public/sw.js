// Hitsune service worker. One job: Android "Share → Hitsune" (Web Share Target, manifest share_target).
// The OS posts the image here; it is parked in Cache Storage and the Body page picks it up and reads it.
// ponytail: no offline caching; add a fetch cache here if offline use is ever needed.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.pathname !== "/share-target") return;
  event.respondWith(
    (async () => {
      const form = await event.request.formData();
      const file = form.get("file");
      if (file instanceof File && file.type.startsWith("image/")) {
        const cache = await caches.open("fuel-share");
        await cache.put("/shared-image", new Response(file, { headers: { "Content-Type": file.type } }));
      }
      return Response.redirect("/mainichi/fuel/body?shared=1", 303);
    })()
  );
});
