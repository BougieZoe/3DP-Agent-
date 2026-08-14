import { describe, it, expect } from 'vitest';
import { isLoopback, effectiveClientIp, bridgeAuthDecision } from './loopbackGuard';
import type { Request } from 'express';

function mockReq(socketIp: string, forwarded?: string): Pick<Request, 'socket' | 'headers'> {
  return {
    socket: { remoteAddress: socketIp } as Request['socket'],
    headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
  };
}

describe('isLoopback', () => {
  it('recognizes IPv4/IPv6 loopback forms', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('192.168.1.50')).toBe(false);
    expect(isLoopback('10.0.0.5')).toBe(false);
  });
});

describe('effectiveClientIp', () => {
  it('trusts x-forwarded-for only when the socket peer is loopback', () => {
    // Local proxy curls in with the real client stamped by vite (xfwd: true).
    expect(effectiveClientIp('127.0.0.1', '192.168.1.50')).toBe('192.168.1.50');
    expect(effectiveClientIp('::1', '192.168.1.50')).toBe('192.168.1.50');
    // Remote spoofing attempt: non-loopback socket, forged header → header ignored.
    expect(effectiveClientIp('192.168.1.50', '127.0.0.1')).toBe('192.168.1.50');
    // Local caller with no header (direct curl to the Express port).
    expect(effectiveClientIp('127.0.0.1', undefined)).toBe('127.0.0.1');
  });
});

describe('bridgeAuthDecision', () => {
  it('production always authenticates', () => {
    expect(bridgeAuthDecision(mockReq('127.0.0.1'), true)).toBe(true);
    expect(bridgeAuthDecision(mockReq('127.0.0.1', '192.168.1.50'), true)).toBe(true);
  });

  it('dev: loopback callers skip auth', () => {
    expect(bridgeAuthDecision(mockReq('127.0.0.1'), false)).toBe(false);
    expect(bridgeAuthDecision(mockReq('::1'), false)).toBe(false);
    expect(bridgeAuthDecision(mockReq('127.0.0.1', '127.0.0.1'), false)).toBe(false);
  });

  it('dev: LAN peers through the vite proxy stay authenticated', () => {
    // Local socket (the proxy) but the real client stamped by xfwd is a LAN IP.
    expect(bridgeAuthDecision(mockReq('127.0.0.1', '192.168.1.50'), false)).toBe(true);
  });

  it('dev: forged loopback header from a remote socket does not bypass', () => {
    expect(bridgeAuthDecision(mockReq('192.168.1.50', '127.0.0.1'), false)).toBe(true);
  });

  it('dev: a dev server published on 0.0.0.0 stays safe for remote callers', () => {
    // Direct hit on a non-loopback interface — even with a fake loopback header.
    expect(bridgeAuthDecision(mockReq('192.168.1.50', '127.0.0.1'), false)).toBe(true);
    expect(bridgeAuthDecision(mockReq('10.0.0.5'), false)).toBe(true);
  });
});