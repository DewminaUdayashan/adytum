import { FastifyRequest, FastifyReply } from 'fastify';
import { singleton, inject } from 'tsyringe';
import { Logger } from '../../logger.js';
import { SkillService } from '../../application/services/skill-service.js';
import { ConfigService } from '../../infrastructure/config/config-service.js';
import { AppError } from '../../domain/errors/app-error.js';
import { relative } from 'node:path';
import { readFileSync } from 'node:fs';

@singleton()
export class SkillController {
  constructor(
    @inject(Logger) private logger: Logger,
    @inject(SkillService) private skillService: SkillService,
    @inject(ConfigService) private configService: ConfigService
  ) {}

  public async getSkills(request: FastifyRequest, reply: FastifyReply) {
    const skills = this.skillService.getAllSkills();
    const config = this.configService.getFullConfig();
    const skillsCfg = config.skills || { enabled: true, allow: [], deny: [], load: { paths: [], extraDirs: [] }, permissions: { install: 'ask' }, entries: {} };

    // Format for response (matching existing API)
    const formattedSkills = skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        version: skill.version,
        origin: skill.origin,
        status: skill.status,
        enabled: skill.enabled,
        error: skill.error,
        toolNames: skill.toolNames,
        serviceIds: skill.serviceIds,
        manifestPath: skill.manifestPath,
        // instructionFiles: skill.instructionFiles.map((filePath) => relative(skill.path, filePath)),
        missing: skill.missing,
        eligible: skill.eligible,
        communication: skill.communication === true,
        install: skill.install || [],
        manifest: skill.manifest,
        requiredEnv: [
          ...(skill.manifest?.metadata?.requires?.env || []),
          ...(skill.manifest?.metadata?.primaryEnv ? [skill.manifest.metadata.primaryEnv] : []),
        ].filter(Boolean),
        // secrets: [], // TODO: secrets handling
        configEntry: skillsCfg.entries?.[skill.id] || {},
        readonly: skill.readonly,
    }));

    return {
        skills: formattedSkills,
        global: {
            enabled: skillsCfg.enabled,
            permissions: skillsCfg.permissions
        }
    };
  }

  // TODO: Implement install, secrets management, instructions editing
  // For now, focusing on read operations to stabilize build/architecture
  public async getSkill(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const skill = this.skillService.getSkill(id);
    if (!skill) {
      throw new AppError(`Skill ${id} not found`, 404);
    }

    const config = this.configService.getFullConfig();
    const skillsCfg = config.skills || { enabled: true, allow: [], deny: [], load: { paths: [], extraDirs: [] }, permissions: { install: 'ask' }, entries: {} };

    // Format single skill response
    const formatted = {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        version: skill.version,
        origin: skill.origin,
        status: skill.status,
        enabled: skill.enabled,
        error: skill.error,
        toolNames: skill.toolNames,
        serviceIds: skill.serviceIds,
        manifestPath: skill.manifestPath,
        missing: skill.missing,
        eligible: skill.eligible,
        communication: skill.communication === true,
        install: skill.install || [],
        manifest: skill.manifest,
        requiredEnv: [
          ...(skill.manifest?.metadata?.requires?.env || []),
          ...(skill.manifest?.metadata?.primaryEnv ? [skill.manifest.metadata.primaryEnv] : []),
        ].filter(Boolean),
        configEntry: skillsCfg.entries?.[skill.id] || {},
        readonly: skill.readonly,
        instructions: skill.instructions // Include instructions for detail view
    };

    return { skill: formatted };
  }

  public async getSkillInstructions(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const instructions = this.skillService.getSkillInstructions(id);
    if (!instructions) {
      throw new AppError(`Skill ${id} not found`, 404);
    }
    return instructions;
  }

  public async updateSkillInstructions(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const { relativePath, content } = request.body as { relativePath: string; content: string };
    
    if (!relativePath || content === undefined) {
      throw new AppError('relativePath and content are required', 400);
    }

    await this.skillService.updateSkillInstructions(id, relativePath, content);
    return { success: true };
  }

  public async updateSkill(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const data = request.body as { enabled?: boolean; config?: any; installPermission?: string };
    
    await this.skillService.updateSkill(id, data);
    return { success: true };
  }

  public async updateSkillSecrets(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const { secrets } = request.body as { secrets: Record<string, string> };
    
    if (!secrets) {
      throw new AppError('secrets are required', 400);
    }

    await this.skillService.setSkillSecrets(id, secrets);
    return { success: true };
  }
}
