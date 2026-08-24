import { randomUUID } from "node:crypto";

import { io } from "socket.io-client";

const origin = process.env.APP_ORIGIN ?? "http://localhost:5173";
const firstApi = process.env.FIRST_API_URL ?? "http://localhost:4000";
const secondApi = process.env.SECOND_API_URL ?? "http://localhost:4001";
const hostEmail = process.env.TEST_HOST_EMAIL;
const guestEmail = process.env.TEST_GUEST_EMAIL;
const password = process.env.TEST_PASSWORD ?? "correct-horse-battery-staple";

if (!hostEmail || !guestEmail) {
  throw new Error("Set TEST_HOST_EMAIL and TEST_GUEST_EMAIL to verified disposable accounts.");
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { origin, "content-type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} returned ${response.status}`);
  }
  return response;
}

async function signIn(baseUrl, email) {
  const response = await request(baseUrl, "/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password, rememberMe: false }),
  });
  const cookies = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]);
  if (cookies.length === 0)
    throw new Error(`Sign-in for ${email} did not return a session cookie.`);
  return cookies.join("; ");
}

function connect(baseUrl, cookie, namespace = "game") {
  return new Promise((resolve, reject) => {
    const socket = io(`${baseUrl}/${namespace}`, {
      path: "/socket.io",
      transports: ["websocket"],
      extraHeaders: { cookie, origin },
      timeout: 5_000,
    });
    const timer = setTimeout(
      () => reject(new Error(`Socket connection to ${baseUrl} timed out.`)),
      6_000,
    );
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForAccount(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Account state was not broadcast.")), 5_000);
    const listener = (state) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      socket.off("account:state", listener);
      resolve(state);
    };
    socket.on("account:state", listener);
  });
}

function command(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} acknowledgement timed out.`)), 5_000);
    socket.emit(event, payload, (result) => {
      clearTimeout(timer);
      if (!result.ok) reject(new Error(`${event} failed with ${result.error.code}`));
      else resolve(result.data);
    });
  });
}

function waitForVersion(socket, version) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`State version ${version} was not broadcast.`)),
      5_000,
    );
    const listener = (game) => {
      if (game.stateVersion < version) return;
      clearTimeout(timer);
      socket.off("game:state", listener);
      resolve(game);
    };
    socket.on("game:state", listener);
  });
}

const hostCookie = await signIn(firstApi, hostEmail);
const guestCookie = await signIn(secondApi, guestEmail);
const createResponse = await request(firstApi, "/api/games", {
  method: "POST",
  headers: { cookie: hostCookie },
  body: JSON.stringify({ turnSeconds: 60, invitation: { type: "link" } }),
});
const created = (await createResponse.json()).data.game;
const joinResponse = await request(secondApi, `/api/invites/${created.inviteCode}/join`, {
  method: "POST",
  headers: { cookie: guestCookie },
  body: "{}",
});
const active = (await joinResponse.json()).data;

const hostSocket = await connect(firstApi, hostCookie);
const guestSocket = await connect(secondApi, guestCookie);
try {
  await Promise.all([
    command(hostSocket, "game:subscribe", { gameId: active.id }),
    command(guestSocket, "game:subscribe", { gameId: active.id }),
  ]);
  const hostId = active.players.find((player) => player.username.startsWith("host_"))?.userId;
  const mover = active.currentTurnUserId === hostId ? hostSocket : guestSocket;
  const bothBroadcasts = Promise.all([
    waitForVersion(hostSocket, active.stateVersion + 1),
    waitForVersion(guestSocket, active.stateVersion + 1),
  ]);
  await command(mover, "game:move", {
    gameId: active.id,
    commandId: randomUUID(),
    column: 3,
    expectedVersion: active.stateVersion,
  });
  await bothBroadcasts;
  await command(hostSocket, "game:resign", { gameId: active.id, commandId: randomUUID() });

  const hostPlayer = active.players.find((player) => player.userId === active.hostUserId);
  const guestPlayer = active.players.find((player) => player.userId !== active.hostUserId);
  if (!hostPlayer || !guestPlayer) throw new Error("Unable to resolve smoke-test players.");
  const hostAccount = await connect(firstApi, hostCookie, "account");
  const guestAccount = await connect(secondApi, guestCookie, "account");
  try {
    const [hostSocial, guestSocial] = await Promise.all([
      command(hostAccount, "account:subscribe", {}),
      command(guestAccount, "account:subscribe", {}),
    ]);
    if (!hostSocial.friends.some((friend) => friend.user.userId === guestPlayer.userId)) {
      const guestRequestBroadcast = waitForAccount(
        guestAccount,
        (state) => state.incomingFriendRequests.length > guestSocial.incomingFriendRequests.length,
      );
      await request(firstApi, "/api/friend-requests", {
        method: "POST",
        headers: { cookie: hostCookie },
        body: JSON.stringify({ username: guestPlayer.username }),
      });
      const guestWithRequest = await guestRequestBroadcast;
      const requestId = guestWithRequest.incomingFriendRequests.find(
        (friendRequest) => friendRequest.user.userId === hostPlayer.userId,
      )?.id;
      if (!requestId) throw new Error("Friend request was not delivered across API nodes.");
      const hostFriendBroadcast = waitForAccount(hostAccount, (state) =>
        state.friends.some((friend) => friend.user.userId === guestPlayer.userId),
      );
      await request(secondApi, `/api/friend-requests/${requestId}/accept`, {
        method: "POST",
        headers: { cookie: guestCookie },
        body: "{}",
      });
      await hostFriendBroadcast;
    }

    const guestGameBroadcast = waitForAccount(guestAccount, (state) =>
      state.incomingGameInvitations.some(
        (invitation) => invitation.host.userId === hostPlayer.userId,
      ),
    );
    const targetedResponse = await request(firstApi, "/api/games", {
      method: "POST",
      headers: { cookie: hostCookie },
      body: JSON.stringify({
        turnSeconds: 60,
        invitation: { type: "friend", userId: guestPlayer.userId },
      }),
    });
    const targeted = (await targetedResponse.json()).data.game;
    await guestGameBroadcast;
    await request(secondApi, `/api/game-invitations/${targeted.id}/accept`, {
      method: "POST",
      headers: { cookie: guestCookie },
      body: "{}",
    });
  } finally {
    hostAccount.disconnect();
    guestAccount.disconnect();
  }
  console.log("Two-node game and account Socket.IO broadcast smoke test passed.");
} finally {
  hostSocket.disconnect();
  guestSocket.disconnect();
}
