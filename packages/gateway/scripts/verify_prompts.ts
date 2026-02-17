
import 'reflect-metadata';
import { AgentRuntime } from '../src/domain/logic/agent-runtime.js';
import { strict as assert } from 'assert';

// Mock dependencies
const mockSoulEngine = { getSoulPrompt: () => 'SOUL' };
const mockSkillLoader = { getSkillsContext: () => 'SKILLS' };
const mockToolRegistry = { toOpenAITools: () => [] };

function verifyTier(tier: 1 | 2 | 3, expectedKeyword: string) {
  const config = {
    soulEngine: mockSoulEngine,
    skillLoader: mockSkillLoader,
    toolRegistry: mockToolRegistry,
    tier,
    agentName: 'TestAgent',
  } as any;

  console.log(`Testing Tier ${tier}...`);
  try {
    const runtime = new AgentRuntime(config);
    // Access private property
    const prompt = (runtime as any).baseSystemPrompt;
    
    if (prompt.includes(expectedKeyword)) {
      console.log(`✅ Tier ${tier} prompt contains "${expectedKeyword}"`);
    } else {
      console.error(`❌ Tier ${tier} prompt MISSING "${expectedKeyword}"`);
      console.error('Prompt preview:', prompt.slice(-500));
      process.exit(1);
    }
  } catch (err) {
    console.error(`Failed to instantiate runtime for Tier ${tier}:`, err);
    process.exit(1);
  }
}

console.log('Verifying prompt injection...');
verifyTier(1, 'ROLE: ARCHITECT');
verifyTier(2, 'STRICT HIERARCHY');
verifyTier(3, 'ROLE: OPERATIVE');
console.log('All prompts verified.');
