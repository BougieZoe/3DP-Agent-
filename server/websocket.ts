/**
 * WebSocket Collaboration Server
 *
 * Handles real-time collaboration via WebSocket:
 * - Session management
 * - Presence broadcasting
 * - Comment relay
 * - Activity feed
 */

import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { Server } from 'http';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WSEvent {
  type: string;
  payload: unknown;
  timestamp: string;
  userId: string;
}

interface Session {
  id: string;
  analysisId: string;
  members: Map<string, MemberInfo>;
}

interface MemberInfo {
  ws: WebSocket;
  userId: string;
  userName: string;
  cursor?: { x: number; y: number; z: number };
  activeModule?: string;
  lastSeen: string;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const sessions = new Map<string, Session>();

export function setupWebSocketServer(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('session');
    const token = url.searchParams.get('token');

    if (!sessionId || !token) {
      ws.close(1008, 'Missing session or token');
      return;
    }

    // TODO: Validate token against auth system
    const userId = `user_${Date.now()}`;
    const userName = `User ${userId.slice(-4)}`;

    // Get or create session
    let session = sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        analysisId: '',
        members: new Map(),
      };
      sessions.set(sessionId, session);
    }

    // Add member
    const member: MemberInfo = {
      ws,
      userId,
      userName,
      lastSeen: new Date().toISOString(),
    };
    session.members.set(userId, member);

    console.log(`[WS] User ${userName} joined session ${sessionId} (${session.members.size} members)`);

    // Broadcast join
    broadcast(session, {
      type: 'join',
      payload: { userId, userName },
      timestamp: new Date().toISOString(),
      userId,
    });

    // Send current presence to new member
    const presenceList = Array.from(session.members.values())
      .filter(m => m.userId !== userId)
      .map(m => ({
        userId: m.userId,
        userName: m.userName,
        cursor: m.cursor,
        activeModule: m.activeModule,
        lastSeen: m.lastSeen,
      }));

    if (presenceList.length > 0) {
      ws.send(JSON.stringify({
        type: 'presence_batch',
        payload: presenceList,
        timestamp: new Date().toISOString(),
        userId: 'system',
      }));
    }

    // Handle messages
    ws.on('message', (data: RawData) => {
      try {
        const event: WSEvent = JSON.parse(data.toString());
        event.userId = userId;

        switch (event.type) {
          case 'cursor':
            member.cursor = event.payload as { x: number; y: number; z: number };
            member.lastSeen = new Date().toISOString();
            broadcast(session!, event, userId);
            break;

          case 'active_module':
            member.activeModule = (event.payload as { module: string }).module;
            member.lastSeen = new Date().toISOString();
            broadcast(session!, event, userId);
            break;

          case 'comment':
            broadcast(session!, event, userId);
            break;

          case 'heartbeat':
            member.lastSeen = new Date().toISOString();
            break;

          default:
            broadcast(session!, event, userId);
        }
      } catch (err) {
        console.error('[WS] Failed to handle message:', err);
      }
    });

    // Handle disconnect
    ws.on('close', () => {
      session!.members.delete(userId);
      console.log(`[WS] User ${userName} left session ${sessionId} (${session!.members.size} members)`);

      broadcast(session!, {
        type: 'leave',
        payload: { userId },
        timestamp: new Date().toISOString(),
        userId,
      });

      // Clean up empty sessions
      if (session!.members.size === 0) {
        sessions.delete(sessionId!);
        console.log(`[WS] Session ${sessionId} destroyed (empty)`);
      }
    });
  });

  console.log('[WS] WebSocket server initialized on /ws');
}

/**
 * Broadcast event to all members in session except sender
 */
function broadcast(session: Session, event: WSEvent, excludeUserId?: string): void {
  const message = JSON.stringify(event);
  for (const [userId, member] of session.members) {
    if (userId !== excludeUserId && member.ws.readyState === WebSocket.OPEN) {
      member.ws.send(message);
    }
  }
}

/**
 * Get active sessions count
 */
export function getActiveSessions(): number {
  return sessions.size;
}

/**
 * Get total connected users
 */
export function getConnectedUsers(): number {
  let count = 0;
  for (const session of sessions.values()) {
    count += session.members.size;
  }
  return count;
}
