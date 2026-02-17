import { EventEmitter } from 'events';
import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { singleton, inject } from 'tsyringe';
import { EventBusService } from './event-bus.js';
import { logger } from '../../logger.js';
import { AdytumEvent } from '@adytum/shared';

@singleton()
export class SocketIOService extends EventEmitter {
  private io: Server | null = null;

  constructor(
    @inject(EventBusService) private eventBus: EventBusService
  ) {
    super();
  }

  initialize(httpServer: HttpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: '*', // Allow all origins for now (dev mode)
        methods: ['GET', 'POST'],
      },
      path: '/socket.io',
    });

    this.io.on('connection', (socket: Socket) => {
      logger.info(`Client connected: ${socket.id}`);

      socket.on('message', (data: any) => {
        // Forward to subscribers (GatewayServer)
        this.emit('message', data);
      });

      socket.on('disconnect', () => {
        logger.info(`Client disconnected: ${socket.id}`);
      });
    });

    // Subscribe to all events on the EventBus and forward to Socket.IO
    this.eventBus.subscribeAll((event: AdytumEvent) => {
      if (this.io) {
        // Broadcast to all connected clients
        // We emit the specific event type as the socket event name
        this.io.emit(event.type, event);
        
        // Also emit a generic 'event' for catch-all listeners on client
        this.io.emit('event', event);
      }
    });

    logger.info('Socket.IO Service initialized and bridged to Event Bus.');
  }

  broadcast(event: string, payload: any) {
    if (this.io) {
      this.io.emit(event, payload);
    }
  }
}
