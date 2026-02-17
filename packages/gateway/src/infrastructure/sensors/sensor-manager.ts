import { singleton, injectAll } from 'tsyringe';
import { logger } from '../../logger.js';
import type { Sensor } from './sensor.interface.js';

@singleton()
export class SensorManager {
  private sensors: Map<string, Sensor> = new Map();

  constructor() {
    // We will register sensors manually or via container token if possible.
    // For now, we allow manual registration to keep it explicit.
  }

  register(sensor: Sensor): void {
    if (this.sensors.has(sensor.id)) {
      logger.warn(`Sensor ${sensor.id} already registered. Skipping.`);
      return;
    }
    this.sensors.set(sensor.id, sensor);
    logger.debug(`Sensor registered: ${sensor.name} (${sensor.id})`);
  }

  async startAll(): Promise<void> {
    logger.info('Starting all sensors...');
    const promises = Array.from(this.sensors.values()).map(async (sensor) => {
      try {
        await sensor.start();
        logger.info(`Sensor started: ${sensor.name}`);
      } catch (err) {
        logger.error({ err, sensor: sensor.id }, 'Failed to start sensor');
      }
    });
    await Promise.all(promises);
  }

  async stopAll(): Promise<void> {
    logger.info('Stopping all sensors...');
    const promises = Array.from(this.sensors.values()).map(async (sensor) => {
      try {
        await sensor.stop();
        logger.info(`Sensor stopped: ${sensor.name}`);
      } catch (err) {
        logger.error({ err, sensor: sensor.id }, 'Failed to stop sensor');
      }
    });
    await Promise.all(promises);
  }

  getStatus(): Record<string, string> {
    const status: Record<string, string> = {};
    for (const sensor of this.sensors.values()) {
      status[sensor.id] = sensor.getStatus();
    }
    return status;
  }
}
