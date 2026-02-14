import { FastifyRequest, FastifyReply } from 'fastify';
import { singleton, inject } from 'tsyringe';
import { Logger } from '../../logger.js';
import { ModelService } from '../../application/services/model-service.js';
import { AppError } from '../../domain/errors/app-error.js';

@singleton()
export class ModelController {
  constructor(
    @inject(Logger) private logger: Logger,
    @inject(ModelService) private modelService: ModelService
  ) {}

  public async getModels(request: FastifyRequest, reply: FastifyReply) {
    const models = await this.modelService.getAllModels();
    return { models };
  }

  public async addModel(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as any;
    if (!body.id || !body.provider || !body.model) {
      throw new AppError('id, provider, and model required', 400);
    }
    
    await this.modelService.addModel({
      id: body.id,
      name: body.name || body.id,
      provider: body.provider,
      model: body.model,
      source: 'user',
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
    });

    return { success: true };
  }

  public async updateModel(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const decodedId = decodeURIComponent(id);
    const body = request.body as any;

    const updated = await this.modelService.updateModel(decodedId, {
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      name: body.name,
    });

    if (!updated) {
      throw new AppError('Model not found', 404);
    }

    return { success: true };
  }

  public async removeModel(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const decodedId = decodeURIComponent(id);
    await this.modelService.removeModel(decodedId);
    return { success: true };
  }

  public async scanLocalModels(request: FastifyRequest, reply: FastifyReply) {
    const discovered = await this.modelService.scanLocalModels();
    return { discovered };
  }
}
