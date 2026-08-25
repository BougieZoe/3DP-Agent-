/**
 * Collaboration WebSocket Server
 *
 * Handles real-time shared viewing, annotations, and chat.
 * Room-based: each order/project has its own room.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

interface Collaborator {
  id: string;
  name: string;
  role: string;
  color: string;
  ws: WebSocket;
}

interface Room {
  id: string;
  collaborators: Map<string, Collaborator>;
  annotations: any[];
  messages: any[];
}

const rooms = new Map<string, Room>();

const COLLABORATOR_COLORS = [
  '#66ccff', '#ff6666', '#66ff66', '#ffcc00',
  '#cc66ff', '#66ffcc', '#ff9966', '#9966ff',
];

function getRoom(roomId: string): Room {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      collaborators: new Map(),
      annotations: [],
      messages: [],
    });
  }
  return rooms.get(roomId)!;
}

function broadcast(room: Room, message: any, excludeId?: string) {
  const data = JSON.stringify(message);
  room.collaborators.forEach((collab) => {
    if (collab.id !== excludeId && collab.ws.readyState === WebSocket.OPEN) {
      collab.ws.send(data);
    }
  });
}

function broadcastAll(room: Room, message: any) {
  const data = JSON.stringify(message);
  room.collaborators.forEach((collab) => {
    if (collab.ws.readyState === WebSocket.OPEN) {
      collab.ws.send(data);
    }
  });
}

export function setupCollaborationServer(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws/collab' });

  wss.on('connection', (ws: WebSocket, req) => {
    // Extract room ID from URL: /ws/collab/:roomId
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const pathParts = url.pathname.split('/');
    const roomId = pathParts[pathParts.length - 1] || 'default';

    const room = getRoom(roomId);
    let collaboratorId: string | null = null;

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.type) {
          case 'join': {
            collaboratorId = message.userId;
            const colorIndex = room.collaborators.size % COLLABORATOR_COLORS.length;

            const collaborator: Collaborator = {
              id: message.userId,
              name: message.userName || `User ${message.userId.slice(-4)}`,
              role: message.role || 'customer',
              color: COLLABORATOR_COLORS[colorIndex],
              ws,
            };

            room.collaborators.set(message.userId, collaborator);

            // Send current state to new user
            ws.send(JSON.stringify({
              type: 'state_sync',
              collaborators: Array.from(room.collaborators.values()).map(c => ({
                id: c.id, name: c.name, role: c.role, color: c.color,
              })),
              annotations: room.annotations,
              messages: room.messages,
            }));

            // Notify others
            broadcast(room, {
              type: 'user_joined',
              userId: message.userId,
              userName: collaborator.name,
              role: collaborator.role,
              color: collaborator.color,
              timestamp: message.timestamp,
            }, message.userId);
            break;
          }

          case 'camera_update': {
            broadcast(room, {
              type: 'camera_update',
              userId: message.userId,
              camera: message.camera,
              timestamp: message.timestamp,
            }, message.userId);
            break;
          }

          case 'annotation_added': {
            const annotation = {
              id: message.annotationId,
              userId: message.userId,
              position: message.position,
              text: message.text,
              type: message.annotationType,
              timestamp: message.timestamp,
            };
            room.annotations.push(annotation);

            broadcastAll(room, {
              type: 'annotation_added',
              ...annotation,
            });
            break;
          }

          case 'annotation_removed': {
            room.annotations = room.annotations.filter(a => a.id !== message.annotationId);

            broadcastAll(room, {
              type: 'annotation_removed',
              annotationId: message.annotationId,
              userId: message.userId,
            });
            break;
          }

          case 'chat_message': {
            const collab = room.collaborators.get(message.userId);
            const chatMsg = {
              id: message.messageId,
              userId: message.userId,
              userName: collab?.name || 'Unknown',
              content: message.content,
              timestamp: message.timestamp,
            };
            room.messages.push(chatMsg);

            // Keep only last 100 messages
            if (room.messages.length > 100) {
              room.messages = room.messages.slice(-100);
            }

            broadcastAll(room, {
              type: 'chat_message',
              ...chatMsg,
            });
            break;
          }
        }
      } catch (e) {
        console.error('WebSocket message error:', e);
      }
    });

    ws.on('close', () => {
      if (collaboratorId) {
        room.collaborators.delete(collaboratorId);

        broadcast(room, {
          type: 'user_left',
          userId: collaboratorId,
          timestamp: new Date().toISOString(),
        });

        // Clean up empty rooms
        if (room.collaborators.size === 0) {
          rooms.delete(roomId);
        }
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  return wss;
}
