/* Small same-origin HTTP client for room-based multiplayer. */
(() => {
  const request = async (path, body) => {
    const response = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      cache: 'no-store',
    });
    let data;
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) throw new Error(data.error || `Network request failed (${response.status})`);
    return data;
  };

  window.RiftNetwork = {
    createRoom: (options) => request('/rooms', options),
    joinRoom: (code, options) => request(`/rooms/${encodeURIComponent(code)}/join`, options),
    update: (session, state, lastEventId) => request(`/rooms/${encodeURIComponent(session.code)}/update`, {
      playerId: session.playerId,
      state,
      lastEventId,
    }),
    fire: (session, state, lastEventId) => request(`/rooms/${encodeURIComponent(session.code)}/fire`, {
      playerId: session.playerId,
      state,
      lastEventId,
    }),
    reload: (session, lastEventId) => request(`/rooms/${encodeURIComponent(session.code)}/reload`, {
      playerId: session.playerId,
      lastEventId,
    }),
    leave: (session) => request(`/rooms/${encodeURIComponent(session.code)}/leave`, {
      playerId: session.playerId,
    }),
  };
})();
