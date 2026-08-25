/**
 * useCollaboration — Real-time collaboration hook
 *
 * Manages WebSocket connection for shared 3D viewing.
 * Syncs camera position, annotations, and chat messages.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

interface Collaborator {
  id: string;
  name: string;
  role: 'designer' | 'supplier' | 'customer';
  color: string;
  cursor?: { x: number; y: number; z: number };
  camera?: {
    position: [number, number, number];
    target: [number, number, number];
  };
}

interface Annotation {
  id: string;
  userId: string;
  position: [number, number, number];
  text: string;
  type: 'risk' | 'question' | 'suggestion' | 'note';
  timestamp: string;
}

interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  content: string;
  timestamp: string;
}

interface CollaborationState {
  connected: boolean;
  room: string | null;
  collaborators: Collaborator[];
  annotations: Annotation[];
  messages: ChatMessage[];
}

export function useCollaboration(userId: string) {
  const [state, setState] = useState<CollaborationState>({
    connected: false,
    room: null,
    collaborators: [],
    annotations: [],
    messages: [],
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  const connect = useCallback((roomId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/collab/${roomId}`);

    ws.onopen = () => {
      setState(prev => ({ ...prev, connected: true, room: roomId }));
      ws.send(JSON.stringify({
        type: 'join',
        userId,
        timestamp: new Date().toISOString(),
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleMessage(data);
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    ws.onclose = () => {
      setState(prev => ({ ...prev, connected: false }));
      // Auto-reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        if (state.room) connect(state.room);
      }, 3000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    wsRef.current = ws;
  }, [userId]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState({
      connected: false,
      room: null,
      collaborators: [],
      annotations: [],
      messages: [],
    });
  }, []);

  const handleMessage = useCallback((data: any) => {
    switch (data.type) {
      case 'user_joined':
        setState(prev => ({
          ...prev,
          collaborators: [...prev.collaborators.filter(c => c.id !== data.userId), {
            id: data.userId,
            name: data.userName,
            role: data.role,
            color: data.color,
          }],
        }));
        break;

      case 'user_left':
        setState(prev => ({
          ...prev,
          collaborators: prev.collaborators.filter(c => c.id !== data.userId),
        }));
        break;

      case 'camera_update':
        setState(prev => ({
          ...prev,
          collaborators: prev.collaborators.map(c =>
            c.id === data.userId
              ? { ...c, camera: data.camera }
              : c
          ),
        }));
        break;

      case 'annotation_added':
        setState(prev => ({
          ...prev,
          annotations: [...prev.annotations, {
            id: data.annotationId,
            userId: data.userId,
            position: data.position,
            text: data.text,
            type: data.annotationType,
            timestamp: data.timestamp,
          }],
        }));
        break;

      case 'annotation_removed':
        setState(prev => ({
          ...prev,
          annotations: prev.annotations.filter(a => a.id !== data.annotationId),
        }));
        break;

      case 'chat_message':
        setState(prev => ({
          ...prev,
          messages: [...prev.messages, {
            id: data.messageId,
            userId: data.userId,
            userName: data.userName,
            content: data.content,
            timestamp: data.timestamp,
          }],
        }));
        break;

      case 'state_sync':
        setState(prev => ({
          ...prev,
          collaborators: data.collaborators || prev.collaborators,
          annotations: data.annotations || prev.annotations,
          messages: data.messages || prev.messages,
        }));
        break;
    }
  }, []);

  const sendCameraUpdate = useCallback((camera: { position: [number, number, number]; target: [number, number, number] }) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'camera_update',
        userId,
        camera,
        timestamp: new Date().toISOString(),
      }));
    }
  }, [userId]);

  const addAnnotation = useCallback((position: [number, number, number], text: string, type: Annotation['type'] = 'note') => {
    const annotationId = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'annotation_added',
        userId,
        annotationId,
        position,
        text,
        annotationType: type,
        timestamp: new Date().toISOString(),
      }));
    }
    return annotationId;
  }, [userId]);

  const removeAnnotation = useCallback((annotationId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'annotation_removed',
        userId,
        annotationId,
        timestamp: new Date().toISOString(),
      }));
    }
  }, [userId]);

  const sendChatMessage = useCallback((content: string) => {
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat_message',
        userId,
        messageId,
        content,
        timestamp: new Date().toISOString(),
      }));
    }
    return messageId;
  }, [userId]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    ...state,
    connect,
    disconnect,
    sendCameraUpdate,
    addAnnotation,
    removeAnnotation,
    sendChatMessage,
  };
}
