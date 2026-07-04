"use client";

// Single reconnecting WebSocket to the backend's /ws, multiplexed by channel.
// Consumers subscribe with a key + a subscribe message and get pushed payloads;
// the useLive hook adds a REST polling fallback for when the socket is down, so
// the app degrades gracefully to the previous behaviour.

import { useEffect, useState } from "react";

const WS_URL =
  (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000").replace(/^http/, "ws") + "/ws";

type Handler = (data: unknown) => void;
interface Sub {
  msg: Record<string, unknown>; // the subscribe message (action added)
  handlers: Set<Handler>;
}

class LiveClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private subs = new Map<string, Sub>();
  private retry: ReturnType<typeof setTimeout> | null = null;
  private statusListeners = new Set<(connected: boolean) => void>();

  isConnected(): boolean {
    return this.connected;
  }

  /** Subscribe to connection-state changes; returns an unsubscribe fn. */
  onStatus(cb: (connected: boolean) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private setConnected(value: boolean): void {
    if (this.connected === value) return;
    this.connected = value;
    this.statusListeners.forEach((l) => l(value));
  }

  private ensure(): void {
    if (typeof window === "undefined") return;
    const s = this.ws?.readyState;
    if (this.ws && (s === WebSocket.OPEN || s === WebSocket.CONNECTING)) return;
    try {
      this.ws = new WebSocket(WS_URL);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.setConnected(true);
      for (const sub of this.subs.values()) this.rawSend(sub.msg);
    };
    this.ws.onmessage = (e) => {
      try {
        const { key, data } = JSON.parse(e.data as string);
        this.subs.get(key)?.handlers.forEach((h) => h(data));
      } catch {
        /* ignore malformed frame */
      }
    };
    this.ws.onclose = () => {
      this.setConnected(false);
      this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      try {
        this.ws?.close();
      } catch {
        /* noop */
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.retry || this.subs.size === 0) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.ensure();
    }, 1500);
  }

  private rawSend(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  subscribe(key: string, msg: Record<string, unknown>, handler: Handler): () => void {
    let sub = this.subs.get(key);
    if (!sub) {
      sub = { msg: { ...msg, action: "subscribe" }, handlers: new Set() };
      this.subs.set(key, sub);
    }
    sub.handlers.add(handler);
    this.ensure();
    this.rawSend(sub.msg);
    return () => {
      const existing = this.subs.get(key);
      if (!existing) return;
      existing.handlers.delete(handler);
      if (existing.handlers.size === 0) {
        this.subs.delete(key);
        this.rawSend({ ...msg, action: "unsubscribe" });
      }
    };
  }
}

export const live = new LiveClient();

interface Fallback<T> {
  fetch: () => Promise<T>;
  intervalMs: number;
}

/**
 * Subscribe to a live channel for the lifetime of the component. Pushes call
 * `onData`; while the socket is not connected, `fallback` (if given) is polled so
 * data still flows. Re-subscribes only when `key` changes (pass a null key to
 * disable). `onData` should be stable (e.g. a state setter).
 */
export const useLive = <T>(
  key: string | null,
  msg: Record<string, unknown>,
  onData: (data: T) => void,
  fallback?: Fallback<T>,
): void => {
  useEffect(() => {
    if (!key) return undefined;
    const unsub = live.subscribe(key, msg, (d) => onData(d as T));
    let timer: ReturnType<typeof setInterval> | null = null;
    if (fallback) {
      const tick = () => {
        if (!live.isConnected()) fallback.fetch().then(onData).catch(() => {});
      };
      tick();
      timer = setInterval(tick, fallback.intervalMs);
    }
    return () => {
      unsub();
      if (timer) clearInterval(timer);
    };
    // Only re-run when the channel key changes; msg/onData/fallback are captured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Reactive WebSocket connection state for a status indicator. */
export const useLiveStatus = (): boolean => {
  const [connected, setConnected] = useState(live.isConnected());
  useEffect(() => {
    setConnected(live.isConnected());
    return live.onStatus(setConnected);
  }, []);
  return connected;
}
