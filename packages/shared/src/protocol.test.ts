/**
 * @file packages/shared/src/protocol.test.ts
 * @description Defines module behavior for the Adytum workspace.
 */

import { describe, it, expect } from 'vitest';
import { parseFrame, serializeFrame } from './protocol.js';
import type { MessageFrame, ConnectFrame } from './protocol.js';

describe('Protocol', () => {
  describe('serializeFrame', () => {
    it('should serialize a connect frame', () => {
      const frame: ConnectFrame = {
        type: 'connect',
        channel: 'default',
        sessionId: '123e4567-e89b-12d3-a456-426614174000',
      };
      const result = serializeFrame(frame);
      expect(result).toBe(JSON.stringify(frame));
    });
  });

  describe('parseFrame', () => {
    it('should parse a valid connect frame', () => {
      const raw = JSON.stringify({
        type: 'connect',
        channel: 'default',
        sessionId: '123e4567-e89b-12d3-a456-426614174000',
      });
      const frame = parseFrame(raw);
      expect(frame).toEqual({
        type: 'connect',
        channel: 'default',
        sessionId: '123e4567-e89b-12d3-a456-426614174000',
      });
    });

    it('should throw on invalid JSON', () => {
      expect(() => parseFrame('invalid json')).toThrow();
    });

    it('should throw on schema validation failure', () => {
      const raw = JSON.stringify({
        type: 'connect',
        // missing channel
      });
      expect(() => parseFrame(raw)).toThrow();
    });
  });
});
