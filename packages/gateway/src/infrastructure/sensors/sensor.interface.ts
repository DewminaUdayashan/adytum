export type SensorStatus = 'active' | 'inactive' | 'error';

/**
 * Standard interface for all background sensors.
 */
export interface Sensor {
  id: string;
  name: string;
  getStatus(): SensorStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
}
