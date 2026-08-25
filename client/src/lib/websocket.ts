/**
 * WebSocket Collaboration Client
 *
 * Real-time collaboration via WebSocket:
 * - Live cursor presence
 * - Real-time comments
 * - Analysis updates
 * - Team activity feed
 */

import type { Comment, Activity, TeamMember } from './collaboration';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WSEvent {
  type: string;
  payload: unknown;
  timestamp: string;
  userId: string;
}

export interface PresenceUpdate {
  userId: string;
  userName: string;
  cursor?: { x: number; y: number; z: number };
  activeModule?: string;
  lastSeen: string;
}

export interface AnalysisUpdate {
  analysisId: string;
  moduleId: string;
  result: unknown;
  updatedBy: string;
}

export interface CollaborationSession {
  id: string;
  analysisId: string;
  members: PresenceUpdate[];
  comments: Comment[];
  activities: Activity[];
}

export type WSCallback = (event: WSEvent) => void;

// ---------------------------------------------------------------------------
// WebSocket Client
// ---------------------------------------------------------------------------

const RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const HEARTBEAT_INTERVAL = 30000;

export class CollaborationClient {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private callbacks: Map<string, Set<WSCallback>> = new Map();
  private reconnectDelay = RECONNECT_DELAY;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _sessionId: string | null = null;
  private _connected = false;
  private _presence: Map<string, PresenceUpdate> = new Map();

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  get connected(): boolean {
    return this._connected;
  }

  get sessionId(): string | null {
    return this._sessionId;
  }

  get presence(): PresenceUpdate[] {
    return Array.from(this._presence.values());
  }

  /**
   * Connect to WebSocket server
   */
  connect(sessionId: string): void {
    if (this.ws) {
      this.disconnect();
    }

    this._sessionId = sessionId;
    const wsUrl = `${this.url}?session=${sessionId}&token=${this.token}`;

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
      this.ws.onerror = this.handleError.bind(this);
    } catch (err) {
      console.error('[WS] Connection failed:', err);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    this._presence.clear();
  }

  /**
   * Send an event to the server
   */
  send(type: string, payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Not connected, queuing event');
      return;
    }

    const event: WSEvent = {
      type,
      payload,
      timestamp: new Date().toISOString(),
      userId: '', // Server fills this in
    };

    this.ws.send(JSON.stringify(event));
  }

  /**
   * Update cursor position for presence
   */
  updateCursor(x: number, y: number, z: number): void {
    this.send('cursor', { x, y, z });
  }

  /**
   * Update active module
   */
  updateActiveModule(module: string): void {
    this.send('active_module', { module });
  }

  /**
   * Send a comment
   */
  sendComment(comment: Omit<Comment, 'id' | 'createdAt' | 'updatedAt' | 'reactions'>): void {
    this.send('comment', comment);
  }

  /**
   * Subscribe to events
   */
  on(type: string, callback: WSCallback): () => void {
    if (!this.callbacks.has(type)) {
      this.callbacks.set(type, new Set());
    }
    this.callbacks.get(type)!.add(callback);

    return () => {
      this.callbacks.get(type)?.delete(callback);
    };
  }

  /**
   * Subscribe to all events
   */
  onAny(callback: WSCallback): () => void {
    return this.on('*', callback);
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  private handleOpen(): void {
    console.log('[WS] Connected');
    this._connected = true;
    this.reconnectDelay = RECONNECT_DELAY;

    // Start heartbeat
    this.heartbeatTimer = setInterval(() => {
      this.send('heartbeat', {});
    }, HEARTBEAT_INTERVAL);

    this.emit('connected', {});
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const wsEvent: WSEvent = JSON.parse(event.data);

      // Update presence
      if (wsEvent.type === 'presence') {
        const presence = wsEvent.payload as PresenceUpdate;
        this._presence.set(presence.userId, presence);
      }

      // Remove presence on leave
      if (wsEvent.type === 'leave') {
        const { userId } = wsEvent.payload as { userId: string };
        this._presence.delete(userId);
      }

      this.emit(wsEvent.type, wsEvent.payload);
      this.emit('*', wsEvent);
    } catch (err) {
      console.error('[WS] Failed to parse message:', err);
    }
  }

  private handleClose(): void {
    console.log('[WS] Disconnected');
    this._connected = false;
    this.heartbeatTimer && clearInterval(this.heartbeatTimer);
    this.emit('disconnected', {});
    this.scheduleReconnect();
  }

  private handleError(event: Event): void {
    console.error('[WS] Error:', event);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this._sessionId) {
        console.log(`[WS] Reconnecting in ${this.reconnectDelay}ms...`);
        this.connect(this._sessionId);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY);
      }
    }, this.reconnectDelay);
  }

  private emit(type: string, payload: unknown): void {
    const callbacks = this.callbacks.get(type);
    if (callbacks) {
      const event: WSEvent = {
        type,
        payload,
        timestamp: new Date().toISOString(),
        userId: '',
      };
      callbacks.forEach(cb => cb(event));
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

let _client: CollaborationClient | null = null;

export function getCollaborationClient(wsUrl?: string, token?: string): CollaborationClient {
  if (!_client) {
    if (!wsUrl || !token) {
      throw new Error('WebSocket URL and token required for first initialization');
    }
    _client = new CollaborationClient(wsUrl, token);
  }
  return _client;
}

export function resetCollaborationClient(): void {
  _client?.disconnect();
  _client = null;
}
