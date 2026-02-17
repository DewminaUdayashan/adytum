import { injectable } from 'tsyringe';
import { ToolResult } from '@adytum/shared';

export type ErrorStrategy = 'retry' | 'fallback' | 'abort' | 'ignore';

export interface ErrorAnalysis {
  strategy: ErrorStrategy;
  suggestion: string;
  isFatal: boolean;
}

@injectable()
export class ToolErrorHandler {
  analyze(error: any, toolName: string, previousAttempts: number): ErrorAnalysis {
    const msg = (error.message || String(error)).toLowerCase();

    // 1. Permission Errors
    if (msg.includes('permission') || msg.includes('access denied') || msg.includes('eacces')) {
      return {
        strategy: 'abort', // Usually requires user intervention
        suggestion: `Permission denied for ${toolName}. Ask the user for access or check file permissions.`,
        isFatal: true,
      };
    }

    // 2. Halucinated Paths / File Not Found
    if (msg.includes('enoent') || msg.includes('no such file')) {
      return {
        strategy: 'retry',
        suggestion: `File not found. Please verify the path using 'file_list' or 'file_search' before retrying.`,
        isFatal: false,
      };
    }

    // 3. Validation / Zod Errors
    if (msg.includes('validation') || msg.includes('zod') || msg.includes('invalid argument')) {
      return {
        strategy: 'retry',
        suggestion: `Invalid arguments for ${toolName}. Check the tool schema and correct the input format.`,
        isFatal: false,
      };
    }

    // 4. Timeouts
    if (msg.includes('timeout') || msg.includes('timed out')) {
      if (previousAttempts < 2) {
        return {
          strategy: 'retry',
          suggestion: `Tool ${toolName} timed out. Retrying might work.`,
          isFatal: false,
        };
      }
    }

    // Default
    return {
      strategy: 'abort',
      suggestion: `Unknown error in ${toolName}: ${msg}`,
      isFatal: true,
    };
  }

  formatErrorForContext(error: any, analysis: ErrorAnalysis): string {
    return `
## Tool Execution Failed
- **Error**: ${error.message}
- **Analysis**: ${analysis.suggestion}
- **Status**: ${analysis.isFatal ? 'FATAL' : 'Recoverable'}
`;
  }
}
