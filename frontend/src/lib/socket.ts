import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './api';

/** Matches the backend gateway's `@SubscribeMessage`. */
export const PROCTORING_EVENT = 'proctoring:event';

export type ProctoringEventType =
  | 'tab_switch'
  | 'fullscreen_exit'
  | 'face_absent'
  | 'face_not_framed'
  | 'multiple_faces'
  | 'multiple_displays_detected'
  /**
   * Sustained sound above a threshold. Named for what is measured: the level is
   * read in the browser and the samples discarded, so this cannot distinguish a
   * voice from a television and must never be presented as "talking".
   */
  | 'background_noise';

export interface ProctoringEvent {
  sessionId: string;
  eventType: ProctoringEventType;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

// The REST base ends in /api; the socket namespace hangs off the origin.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api';
const ORIGIN = API_URL.replace(/\/api\/?$/, '');

/**
 * Opens the proctoring channel for one session.
 *
 * The access token travels in the handshake rather than a header — it lives in
 * memory in this app, and the gateway has to authenticate the socket itself
 * because Nest's HTTP guards never see one.
 */
export function connectProctoring(): Socket {
  return io(`${ORIGIN}/proctoring`, {
    auth: { token: getAccessToken() },
    withCredentials: true,
    transports: ['websocket'],
    // Violations are advisory, not a payment: a few lost events during a
    // network blip must never block or interrupt the candidate's test.
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });
}
