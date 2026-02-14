import { FastifyRequest, FastifyReply } from 'fastify';
import { singleton, inject } from 'tsyringe';
import { Logger } from '../../logger.js';
import { CronManager } from '../../application/services/cron-manager.js';
import { AppError } from '../../domain/errors/app-error.js';

@singleton()
export class TaskController {
  constructor(
    @inject(Logger) private logger: Logger,
    @inject(CronManager) private cronManager: CronManager
  ) {}

  public async getJobs(request: FastifyRequest, reply: FastifyReply) {
    const jobs = this.cronManager.getAllJobs();
    return { jobs };
  }

  public async createJob(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as { name: string; schedule: string; task: string };
    if (!body.name || !body.schedule || !body.task) {
      throw new AppError('name, schedule, and task are required', 400);
    }
    const job = this.cronManager.addJob(body.name, body.schedule, body.task);
    return { job };
  }

  public async updateJob(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    
    try {
      const job = this.cronManager.updateJob(id, body);
      return { job };
    } catch (error: any) {
      throw new AppError(error.message, 404);
    }
  }

  public async deleteJob(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    this.cronManager.removeJob(id);
    return { success: true };
  }
}
