/* Shared weapon balance for the browser client and multiplayer server. */
(function (root, factory) {
  const weapons = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = weapons;
  root.RiftWeapons = weapons;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  return [
    { id: 'classic', name: 'CLASSIC', type: 'SIDEARM', mag: 12, damage: 48, interval: 260, reserve: 48, reloadMs: 1150, price: 0 },
    { id: 'vandal', name: 'VANDAL', type: 'ASSAULT RIFLE', mag: 30, damage: 34, interval: 105, reserve: 90, reloadMs: 1500, price: 2700 },
    { id: 'marshal', name: 'MARSHAL', type: 'MARKSMAN RIFLE', mag: 5, damage: 100, interval: 780, reserve: 25, reloadMs: 2100, price: 1200 },
  ];
});
