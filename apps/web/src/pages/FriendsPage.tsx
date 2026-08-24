import type {
  CreateGameResponse,
  SocialSnapshot,
  TurnSeconds,
  UserSearchResult,
} from "@four/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Gamepad2, Search, UserMinus, UserPlus, UsersRound, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api";
import { Alert } from "../components";
import { useSocial } from "../social-context";

type SocialAction =
  { kind: "accept" | "decline" | "cancel"; requestId: string } | { kind: "remove"; userId: string };

function socialActionRequest(action: SocialAction) {
  switch (action.kind) {
    case "accept":
      return api<SocialSnapshot>(`/api/friend-requests/${action.requestId}/accept`, {
        method: "POST",
      });
    case "decline":
      return api<SocialSnapshot>(`/api/friend-requests/${action.requestId}/decline`, {
        method: "POST",
      });
    case "cancel":
      return api<SocialSnapshot>(`/api/friend-requests/${action.requestId}`, {
        method: "DELETE",
      });
    case "remove":
      return api<SocialSnapshot>(`/api/friends/${encodeURIComponent(action.userId)}`, {
        method: "DELETE",
      });
  }
}

export function FriendsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { social, isLoading, error: socialError } = useSocial();
  const [username, setUsername] = useState("");
  const [searchResult, setSearchResult] = useState<UserSearchResult | null>(null);
  const [clockByFriend, setClockByFriend] = useState<Record<string, TurnSeconds>>({});

  const search = useMutation({
    mutationFn: (value: string) =>
      api<UserSearchResult>(`/api/users/search?username=${encodeURIComponent(value.trim())}`),
    onSuccess: setSearchResult,
  });
  const sendRequest = useMutation({
    mutationFn: (value: string) =>
      api<SocialSnapshot>("/api/friend-requests", {
        method: "POST",
        body: JSON.stringify({ username: value }),
      }),
    onSuccess: (state) => {
      queryClient.setQueryData(["social"], state);
      setSearchResult((current) =>
        current ? { ...current, relationship: "outgoing_request", canSendRequest: false } : null,
      );
    },
  });
  const socialAction = useMutation({
    mutationFn: socialActionRequest,
    onSuccess: (state) => queryClient.setQueryData(["social"], state),
  });
  const challenge = useMutation({
    mutationFn: ({ userId, turnSeconds }: { userId: string; turnSeconds: TurnSeconds }) =>
      api<CreateGameResponse>("/api/games", {
        method: "POST",
        body: JSON.stringify({
          turnSeconds,
          invitation: { type: "friend", userId },
        }),
      }),
    onSuccess: ({ game }) => navigate(`/game/${game.id}`),
  });

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSearchResult(null);
    if (username.trim()) search.mutate(username);
  }

  const actionError = search.error ?? sendRequest.error ?? socialAction.error ?? challenge.error;

  return (
    <main className="friends-page content-width">
      <header className="page-heading social-heading">
        <p className="eyebrow">Your circle</p>
        <h1>Friends</h1>
        <p>Find an exact username, connect, then invite them straight to your next game.</p>
      </header>

      <section className="friend-search-card" aria-labelledby="find-player-title">
        <div>
          <h2 id="find-player-title">Find a player</h2>
          <p>Usernames are exact, but capitalisation does not matter.</p>
        </div>
        <form className="friend-search" onSubmit={submitSearch}>
          <label htmlFor="friend-username">Username</label>
          <div>
            <input
              id="friend-username"
              minLength={3}
              maxLength={20}
              pattern="[A-Za-z0-9_]+"
              placeholder="e.g. yellowchamp"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <button className="button button--primary" disabled={search.isPending} type="submit">
              <Search size={18} />
              {search.isPending ? "Searching…" : "Search"}
            </button>
          </div>
        </form>
        {searchResult && (
          <article className="search-result" aria-live="polite">
            <span className="social-avatar">{searchResult.user.username[0]?.toUpperCase()}</span>
            <div>
              <strong>{searchResult.user.username}</strong>
              <small>
                {searchResult.relationship === "friends"
                  ? "Already a friend"
                  : searchResult.relationship === "incoming_request"
                    ? "Sent you a request"
                    : searchResult.relationship === "outgoing_request"
                      ? "Request pending"
                      : searchResult.relationship === "unavailable"
                        ? "Not available to add"
                        : "Player found"}
              </small>
            </div>
            {searchResult.canSendRequest && (
              <button
                className="button button--soft"
                disabled={sendRequest.isPending}
                onClick={() => sendRequest.mutate(searchResult.user.username)}
              >
                <UserPlus size={18} />
                {sendRequest.isPending ? "Sending…" : "Add friend"}
              </button>
            )}
          </article>
        )}
      </section>

      {(socialError || actionError) && (
        <Alert>{socialError?.message ?? actionError?.message ?? "The request failed."}</Alert>
      )}

      {(social?.incomingFriendRequests.length ?? 0) > 0 && (
        <section className="dashboard-section" aria-labelledby="incoming-friends-title">
          <div className="section-title">
            <div>
              <UserPlus />
              <h2 id="incoming-friends-title">Friend requests</h2>
            </div>
            <span>{social?.incomingFriendRequests.length}</span>
          </div>
          <div className="social-list">
            {social?.incomingFriendRequests.map((request) => (
              <article className="social-row" key={request.id}>
                <span className="social-avatar">{request.user.username[0]?.toUpperCase()}</span>
                <div className="social-row__copy">
                  <strong>{request.user.username}</strong>
                  <small>Would like to be friends</small>
                </div>
                <div className="social-row__actions">
                  <button
                    className="button button--soft"
                    onClick={() => socialAction.mutate({ kind: "accept", requestId: request.id })}
                  >
                    <Check size={17} /> Accept
                  </button>
                  <button
                    className="button button--ghost-dark"
                    onClick={() => socialAction.mutate({ kind: "decline", requestId: request.id })}
                  >
                    <X size={17} /> Decline
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="dashboard-section" aria-labelledby="your-friends-title">
        <div className="section-title">
          <div>
            <UsersRound />
            <h2 id="your-friends-title">Your friends</h2>
          </div>
          <span>{social?.friends.length ?? 0}</span>
        </div>
        {isLoading ? (
          <div className="skeleton-list">
            <i />
            <i />
          </div>
        ) : social?.friends.length ? (
          <div className="social-list">
            {social.friends.map((friend) => {
              const turnSeconds = clockByFriend[friend.user.userId] ?? 60;
              const pending =
                social.outgoingGameInvitations.some(
                  (invite) => invite.invitee.userId === friend.user.userId,
                ) ||
                social.incomingGameInvitations.some(
                  (invite) => invite.host.userId === friend.user.userId,
                );
              return (
                <article className="social-row friend-row" key={friend.relationshipId}>
                  <span className="social-avatar">{friend.user.username[0]?.toUpperCase()}</span>
                  <div className="social-row__copy">
                    <strong>{friend.user.username}</strong>
                    <small>{pending ? "Game invitation pending" : "Ready for a challenge"}</small>
                  </div>
                  <div className="social-row__actions challenge-actions">
                    <label>
                      <span className="sr-only">Turn clock for {friend.user.username}</span>
                      <select
                        value={turnSeconds}
                        onChange={(event) =>
                          setClockByFriend((current) => ({
                            ...current,
                            [friend.user.userId]: Number(event.target.value) as TurnSeconds,
                          }))
                        }
                      >
                        <option value={30}>30 sec</option>
                        <option value={60}>60 sec</option>
                        <option value={120}>2 min</option>
                      </select>
                    </label>
                    <button
                      className="button button--soft"
                      disabled={pending || challenge.isPending}
                      onClick={() => challenge.mutate({ userId: friend.user.userId, turnSeconds })}
                    >
                      <Gamepad2 size={17} /> {pending ? "Invited" : "Challenge"}
                    </button>
                    <button
                      className="icon-button icon-button--danger"
                      aria-label={`Remove ${friend.user.username} from friends`}
                      onClick={() =>
                        socialAction.mutate({ kind: "remove", userId: friend.user.userId })
                      }
                    >
                      <UserMinus size={18} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-panel">
            <UsersRound />
            <h3>Your friends will appear here</h3>
            <p>Search for someone by their exact username to get started.</p>
          </div>
        )}
      </section>

      {(social?.outgoingFriendRequests.length ?? 0) > 0 && (
        <section className="dashboard-section" aria-labelledby="sent-requests-title">
          <div className="section-title">
            <div>
              <UserPlus />
              <h2 id="sent-requests-title">Sent requests</h2>
            </div>
          </div>
          <div className="social-list">
            {social?.outgoingFriendRequests.map((request) => (
              <article className="social-row" key={request.id}>
                <span className="social-avatar">{request.user.username[0]?.toUpperCase()}</span>
                <div className="social-row__copy">
                  <strong>{request.user.username}</strong>
                  <small>Waiting for a response</small>
                </div>
                <button
                  className="button button--ghost-dark"
                  onClick={() => socialAction.mutate({ kind: "cancel", requestId: request.id })}
                >
                  Cancel request
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
