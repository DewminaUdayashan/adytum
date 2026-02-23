import { singleton, inject } from 'tsyringe';
import { EventBusService } from '../events/event-bus.js';
import { type Sensor, type SensorStatus } from './sensor.interface.js';
import { SystemEvents } from '@adytum/shared';
import { logger } from '../../logger.js';

@singleton()
export class SystemHealthSensor implements Sensor {
  public readonly id = 'system-health';
  public readonly name = 'System Health Monitor';

  private interval: NodeJS.Timeout | null = null;
  private status: SensorStatus = 'inactive';
  private readonly checkIntervalMs = 30000; // 30 seconds
  private readonly memoryThresholdMb = 1024; // 1GB warning threshold

  constructor(@inject(EventBusService) private eventBus: EventBusService) {}

  getStatus(): SensorStatus {
    return this.status;
  }

  async start(): Promise<void> {
    if (this.interval) return;

    logger.debug(`Starting SystemHealthSensor (Interval: ${this.checkIntervalMs}ms)`);

    // Initial check immediately
    this.checkHealth();

    this.interval = setInterval(() => {
      this.checkHealth();
    }, this.checkIntervalMs);

    this.status = 'active';
  }

  private checkHealth(): void {
    try {
      const memoryUsage = process.memoryUsage();
      const rssMb = Math.round(memoryUsage.rss / 1024 / 1024);
      const heapTotalMb = Math.round(memoryUsage.heapTotal / 1024 / 1024);
      const heapUsedMb = Math.round(memoryUsage.heapUsed / 1024 / 1024);

      // Emit usage stats
      this.eventBus.publish(
        SystemEvents.RESOURCE_USAGE,
        {
          memory: {
            rss: rssMb,
            heapTotal: heapTotalMb,
            heapUsed: heapUsedMb,
          },
          uptime: process.uptime(),
          timestamp: Date.now(),
        },
        this.id,
      );

      // Check threshold
      if (rssMb > this.memoryThresholdMb) {
        logger.warn(`High memory usage detected: ${rssMb}MB`);
        this.eventBus.publish(
          SystemEvents.HEALTH_WARNING,
          {
            component: 'memory',
            message: `High memory usage: ${rssMb}MB (Threshold: ${this.memoryThresholdMb}MB)`,
            severity: 'warning',
          },
          this.id,
        );
      }
    } catch (err) {
      logger.error({ err }, 'Failed to check system health');
      this.status = 'error';
    }
  }

  async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.status = 'inactive';
  }
}
